import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const REVIEW_STORAGE_ROOT = path.resolve(process.cwd(), "storage", "pdf-reviews");

function sanitizeName(name = "review.pdf") {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80) || "review.pdf";
}

function extractPdfBase64(dataUrl = "") {
  const match = /^data:application\/pdf;base64,(.+)$/i.exec(dataUrl);

  if (!match) {
    throw new Error("PDF encoding is invalid.");
  }

  return match[1];
}

export function getPdfReviewStorageRoot() {
  return REVIEW_STORAGE_ROOT;
}

export async function ensurePdfReviewStorageRoot() {
  await mkdir(REVIEW_STORAGE_ROOT, { recursive: true });
}

export async function writePdfReviewFile({ dataUrl, name }) {
  await ensurePdfReviewStorageRoot();
  const fileName = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}-${sanitizeName(name)}`;
  const absolutePath = path.join(REVIEW_STORAGE_ROOT, fileName);
  await writeFile(absolutePath, Buffer.from(extractPdfBase64(dataUrl), "base64"));

  return {
    storageKey: fileName,
    publicUrl: `/review-assets/${fileName}`
  };
}

export async function deletePdfReviewFile(storageKey) {
  if (!storageKey) {
    return;
  }

  try {
    await unlink(path.join(REVIEW_STORAGE_ROOT, storageKey));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
