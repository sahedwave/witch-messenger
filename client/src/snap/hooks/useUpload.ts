import { useState } from "react";

import { SNAP_MAX_DURATION_SECONDS, SNAP_MAX_IMAGE_BYTES, SNAP_MAX_VIDEO_BYTES } from "../constants";
import { getSnapFilter } from "../SnapFilters";
import { compressImageBlob, generateThumbnail, optimizeVideoBlob } from "../services/snapCompressor";
import { uploadSnapAsset } from "../services/snapUploader";
import type { SnapDraft } from "./useSnapState";

type UploadDraftInput = {
  draft: SnapDraft;
  filterId: string;
  caption: string;
};

export function useUpload() {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  async function uploadDraft({ draft, filterId, caption }: UploadDraftInput) {
    const selectedFilter = getSnapFilter(filterId);

    try {
      setIsUploading(true);
      setError("");

      const optimized =
        draft.kind === "photo"
          ? await compressImageBlob(draft.blob, {
              maxBytes: SNAP_MAX_IMAGE_BYTES,
              filterCss: draft.filterAppliedInMedia ? "none" : selectedFilter.filter
            })
          : await optimizeVideoBlob(draft.blob, {
              maxBytes: SNAP_MAX_VIDEO_BYTES
            });

      const thumbnailBlob = await generateThumbnail(optimized.blob, {
        filterCss:
          draft.kind === "photo" && !draft.filterAppliedInMedia
            ? selectedFilter.filter
            : "none"
      });

      const uploadResult = await uploadSnapAsset({
        file: optimized.blob,
        thumbnail: thumbnailBlob,
        fileName: draft.fileName,
        thumbnailName: `${draft.fileName.replace(/\.[^.]+$/, "")}-thumb.webp`,
        mimeType: optimized.blob.type || draft.mimeType
      });

      return {
        ...uploadResult,
        caption,
        duration: Math.max(
          1,
          Math.min(SNAP_MAX_DURATION_SECONDS, Math.ceil(draft.durationMs / 1000 || 10))
        ),
        fileName: draft.fileName,
        mimeType: optimized.blob.type || draft.mimeType,
        size: optimized.blob.size
      };
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : "Unable to upload this snap.";
      setError(message);
      throw new Error(message);
    } finally {
      setIsUploading(false);
    }
  }

  return {
    isUploading,
    error,
    uploadDraft
  };
}
