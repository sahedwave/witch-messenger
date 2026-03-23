import fs from "fs";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";

const filename = "./src/components/WorkspaceMessenger.jsx";
const code = fs.readFileSync(filename, "utf8");

const ast = parse(code, {
  sourceType: "module",
  plugins: ["jsx", "importMeta"],
  errorRecovery: true
});

const globals = new Set([
  "console", "Object", "Array", "String", "Number",
  "Boolean", "Date", "Math", "JSON", "Promise", "Error",
  "Map", "Set", "WeakMap", "WeakSet", "Symbol",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "fetch", "setTimeout", "clearTimeout", "setInterval",
  "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
  "queueMicrotask", "window", "document", "navigator", "location",
  "history", "performance", "crypto", "URL", "URLSearchParams",
  "FormData", "Blob", "File", "FileReader", "localStorage",
  "sessionStorage", "React", "useState", "useEffect", "useCallback",
  "useMemo", "useRef", "useContext", "useReducer", "createContext",
  "lazy", "Suspense", "memo", "Fragment", "forwardRef", "motion",
  "AnimatePresence", "Intl", "Infinity", "undefined", "NaN"
]);

const unresolved = new Map();

function record(name, line) {
  if (!unresolved.has(name)) {
    unresolved.set(name, []);
  }
  const lines = unresolved.get(name);
  if (!lines.includes(line) && lines.length < 5) {
    lines.push(line);
  }
}

function isKnownGlobal(name) {
  return globals.has(name);
}

function isReferenceIdentifier(path) {
  if (!path.isIdentifier()) {
    return false;
  }

  const parent = path.parentPath;
  if (!parent) {
    return false;
  }

  if (!path.isReferencedIdentifier()) {
    return false;
  }

  if (
    parent.isMemberExpression() &&
    parent.get("property") === path &&
    !parent.node.computed
  ) {
    return false;
  }

  if (
    parent.isOptionalMemberExpression?.() &&
    parent.get("property") === path &&
    !parent.node.computed
  ) {
    return false;
  }

  return true;
}

function isRelevantJsxIdentifier(path) {
  if (!path.isJSXIdentifier()) {
    return false;
  }

  const name = path.node.name;
  if (!/^[A-Z]/.test(name)) {
    return false;
  }

  const parent = path.parentPath;
  if (!parent) {
    return false;
  }

  if (parent.isJSXOpeningElement() || parent.isJSXClosingElement()) {
    return parent.get("name") === path;
  }

  if (parent.isJSXMemberExpression()) {
    return false;
  }

  return false;
}

traverse.default(ast, {
  Identifier(path) {
    if (!isReferenceIdentifier(path)) {
      return;
    }

    const name = path.node.name;
    if (isKnownGlobal(name)) {
      return;
    }

    if (path.scope.hasBinding(name, true) || path.scope.hasGlobal(name)) {
      return;
    }

    record(name, path.node.loc?.start?.line ?? null);
  },
  JSXIdentifier(path) {
    if (!isRelevantJsxIdentifier(path)) {
      return;
    }

    const name = path.node.name;
    if (isKnownGlobal(name)) {
      return;
    }

    if (path.scope.hasBinding(name, true) || path.scope.hasGlobal(name)) {
      return;
    }

    record(name, path.node.loc?.start?.line ?? null);
  }
});

const result = [...unresolved.entries()].sort((left, right) => left[0].localeCompare(right[0]));

console.log("=== SCOPE-AWARE SCAN RESULTS ===");
console.log(`Total unresolved: ${result.length}`);
console.log("");
for (const [name, lines] of result) {
  console.log(`${name} — lines: ${lines.join(", ")}`);
}

process.exitCode = result.length > 5 ? 1 : 0;
