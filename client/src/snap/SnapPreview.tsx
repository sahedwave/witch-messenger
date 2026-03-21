import { motion } from "framer-motion";

import SnapFilters, { getSnapFilter } from "./SnapFilters";
import type { SnapDraft } from "./hooks/useSnapState";

type SnapPreviewProps = {
  draft: SnapDraft;
  caption: string;
  selectedFilterId: string;
  isUploading: boolean;
  error?: string;
  onCaptionChange: (caption: string) => void;
  onFilterSelect: (filterId: string) => void;
  onRetake: () => void;
  onSend: () => void;
  onClose: () => void;
};

export default function SnapPreview({
  draft,
  caption,
  selectedFilterId,
  isUploading,
  error = "",
  onCaptionChange,
  onFilterSelect,
  onRetake,
  onSend,
  onClose
}: SnapPreviewProps) {
  const selectedFilter = getSnapFilter(selectedFilterId);

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white" style={{ display: "flex", height: "100%", flexDirection: "column", background: "#020617", color: "#ffffff" }}>
      <div className="flex items-center justify-between px-4 py-4" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16 }}>
        <button
          type="button"
          className="min-h-11 rounded-full border border-white/15 bg-white/8 px-4 text-sm font-semibold"
          onClick={onRetake}
          style={{ minHeight: 44, borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#ffffff", padding: "0 16px" }}
        >
          Retake
        </button>
        <button
          type="button"
          className="min-h-11 rounded-full border border-white/15 bg-white/8 px-4 text-sm font-semibold"
          onClick={onClose}
          style={{ minHeight: 44, borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#ffffff", padding: "0 16px" }}
        >
          Close
        </button>
      </div>

      <div className="relative flex-1 px-4" style={{ position: "relative", flex: 1, padding: "0 16px" }}>
        <motion.div
          layout
          className="relative mx-auto h-full max-h-[62vh] overflow-hidden rounded-[28px] border border-white/10 bg-black shadow-2xl"
          style={{ position: "relative", margin: "0 auto", height: "100%", maxHeight: "62vh", overflow: "hidden", borderRadius: 28, border: "1px solid rgba(255,255,255,0.1)", background: "#000000" }}
        >
          {draft.kind === "video" ? (
            <video
              className="h-full w-full object-cover"
              style={{ filter: selectedFilter.filter }}
              src={draft.previewUrl}
              autoPlay
              muted
              loop
              playsInline
              controls={false}
            />
          ) : (
            <img
              className="h-full w-full object-cover"
              style={{ filter: selectedFilter.filter }}
              src={draft.previewUrl}
              alt="Snap preview"
            />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent px-5 pb-5 pt-16">
            {caption ? <p className="text-lg font-semibold tracking-tight">{caption}</p> : null}
            <span className="mt-2 block text-xs uppercase tracking-[0.18em] text-white/60">
              {draft.kind === "video" ? "Video snap" : "Photo snap"}
            </span>
          </div>
        </motion.div>
      </div>

      <div className="space-y-3 px-4 pb-4 pt-4" style={{ display: "grid", gap: 12, padding: 16 }}>
        <label className="block">
          <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/60">
            Caption
          </span>
          <textarea
            rows={2}
            maxLength={140}
            value={caption}
            onChange={(event) => onCaptionChange(event.target.value)}
            placeholder="Add a caption"
            className="min-h-24 w-full rounded-[22px] border border-white/12 bg-white/8 px-4 py-3 text-base text-white placeholder:text-white/35 focus:border-white/40 focus:outline-none"
            style={{ minHeight: 96, width: "100%", borderRadius: 22, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.08)", color: "#ffffff", padding: "12px 16px" }}
          />
        </label>

        <div>
          <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-white/60">
            Filter
          </span>
          <SnapFilters selectedId={selectedFilterId} onSelect={onFilterSelect} compact />
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            {error}
          </div>
        ) : null}

        <div className="flex gap-3" style={{ display: "flex", gap: 12 }}>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-full border border-white/15 bg-white/8 px-4 text-sm font-semibold"
            onClick={onRetake}
            disabled={isUploading}
            style={{ minHeight: 44, flex: 1, borderRadius: 999, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", color: "#ffffff", padding: "0 16px" }}
          >
            Retake
          </button>
          <button
            type="button"
            className="min-h-11 flex-1 rounded-full bg-cyan-300 px-4 text-sm font-semibold text-slate-950 shadow-lg disabled:opacity-55"
            onClick={onSend}
            disabled={isUploading}
            style={{ minHeight: 44, flex: 1, borderRadius: 999, background: "#67e8f9", color: "#0f172a", padding: "0 16px", opacity: isUploading ? 0.55 : 1 }}
          >
            {isUploading ? "Sending..." : "Send Snap"}
          </button>
        </div>
      </div>
    </div>
  );
}
