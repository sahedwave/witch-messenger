import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./monitoring";
import "./index.css";
import "./styles/workspace-ui.css";

const WorkspaceMessenger = lazy(() =>
  import("./components/WorkspaceMessenger").then((module) => ({
    default: module.WorkspaceMessenger
  }))
);
const GhostingRoute = lazy(() =>
  import("./components/GhostingRoute").then((module) => ({
    default: module.GhostingRoute
  }))
);

const params = new URLSearchParams(window.location.search);
const businessView = params.get("view") === "workspace-messenger";
const ghostingView = params.get("view") === "ghosting";
const businessRole = params.get("userRole") || "manager";
const businessNav = params.get("nav") || "inbox";
const businessThread = params.get("thread") || null;

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : "Unknown runtime error."
    };
  }

  componentDidCatch(error) {
    console.error("Application runtime error:", error);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: 24,
          background: "#eef4fb",
          color: "#17324d",
          fontFamily: "DM Sans, system-ui, sans-serif"
        }}
      >
        <div
          style={{
            width: "min(560px, 100%)",
            borderRadius: 24,
            border: "1px solid rgba(23,50,77,0.08)",
            background: "#ffffff",
            padding: 24,
            boxShadow: "0 24px 60px rgba(23,50,77,0.12)"
          }}
        >
          <strong style={{ display: "block", fontSize: 20, marginBottom: 10 }}>
            The app hit a runtime error
          </strong>
          <p style={{ margin: 0, color: "#57708d", lineHeight: 1.6 }}>
            Refresh the page. If the problem continues, restart the dev server. The latest error was:
          </p>
          <pre
            style={{
              marginTop: 16,
              borderRadius: 16,
              background: "#f5f8fc",
              padding: 16,
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              color: "#17324d"
            }}
          >
            {this.state.errorMessage}
          </pre>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "100vh",
              display: "grid",
              placeItems: "center",
              padding: 24,
              background: "#eef4fb",
              color: "#17324d",
              fontFamily: "DM Sans, system-ui, sans-serif"
            }}
          >
            <div
              style={{
                width: "min(420px, 100%)",
                borderRadius: 24,
                border: "1px solid rgba(23,50,77,0.08)",
                background: "#ffffff",
                padding: 24,
                boxShadow: "0 24px 60px rgba(23,50,77,0.12)"
              }}
            >
              Loading app...
            </div>
          </div>
        }
      >
        {ghostingView ? (
          <GhostingRoute />
        ) : businessView ? (
          <WorkspaceMessenger
            userRole={businessRole}
            initialNav={businessNav}
            initialThreadId={businessThread}
          />
        ) : (
          <App />
        )}
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>
);
