import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import SnapCountdown from "./SnapCountdown";

type SnapMessage = {
  id?: string;
  text?: string;
  attachment: {
    dataUrl: string;
    mimeType?: string;
    name?: string;
  };
  sender?: {
    name?: string;
  };
  snapViewSeconds?: number;
  autoDeleteAt?: string | null;
};

type SnapViewerProps = {
  snap: SnapMessage | null;
  onClose: () => void;
};

export default function SnapViewer({ snap, onClose }: SnapViewerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  const totalSeconds = useMemo(() => {
    if (!snap) {
      return 10;
    }

    if (snap.autoDeleteAt) {
      return Math.max(1, Math.ceil((new Date(snap.autoDeleteAt).getTime() - Date.now()) / 1000));
    }

    return Math.max(1, snap.snapViewSeconds || 10);
  }, [snap]);

  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);

  useEffect(() => {
    if (!snap) {
      return;
    }

    setSecondsLeft(totalSeconds);

    const timerId = window.setInterval(() => {
      const remaining = snap.autoDeleteAt
        ? Math.max(0, Math.ceil((new Date(snap.autoDeleteAt).getTime() - Date.now()) / 1000))
        : Math.max(0, totalSeconds - 1);

      setSecondsLeft((current) => {
        if (!snap.autoDeleteAt) {
          return Math.max(0, current - 1);
        }

        return remaining;
      });
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [snap, totalSeconds]);

  useEffect(() => {
    if (!snap) {
      return;
    }

    if (snap.attachment.mimeType?.startsWith("video/")) {
      videoRef.current?.play().catch(() => null);
    }
  }, [snap]);

  useEffect(() => {
    if (secondsLeft <= 0) {
      onClose();
    }
  }, [onClose, secondsLeft]);

  if (!snap) {
    return null;
  }

  const isExpired = Boolean(snap.autoDeleteAt) && new Date(snap.autoDeleteAt).getTime() <= Date.now();

  if (typeof document === "undefined") {
    return null;
  }

  const modal = (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/92 px-4 py-6"
        style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(2,6,23,0.92)", padding: 16 }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="relative flex h-full w-full max-w-[420px] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-black shadow-[0_30px_100px_rgba(0,0,0,0.45)]"
          style={{ position: "relative", display: "flex", width: "100%", maxWidth: 420, height: "100%", flexDirection: "column", overflow: "hidden", borderRadius: 32, border: "1px solid rgba(255,255,255,0.1)", background: "#000000" }}
          initial={{ y: 24, scale: 0.97 }}
          animate={{ y: dragOffset, scale: 1 }}
          exit={{ y: 20, scale: 0.97, opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          onPointerDown={(event) => {
            dragStartYRef.current = event.clientY;
          }}
          onPointerMove={(event) => {
            if (dragStartYRef.current === null) {
              return;
            }

            setDragOffset(Math.max(0, event.clientY - dragStartYRef.current));
          }}
          onPointerUp={() => {
            if (dragOffset > 120) {
              onClose();
            }

            dragStartYRef.current = null;
            setDragOffset(0);
          }}
          onPointerCancel={() => {
            dragStartYRef.current = null;
            setDragOffset(0);
          }}
        >
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 px-4 py-4">
            <SnapCountdown totalSeconds={totalSeconds} secondsLeft={Math.max(0, secondsLeft)} />
            <button
              type="button"
              className="min-h-11 rounded-full border border-white/15 bg-slate-950/50 px-4 text-sm font-semibold text-white backdrop-blur"
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              Close
            </button>
          </div>

          <div className="relative flex-1">
            {isExpired ? (
              <div className="flex h-full items-center justify-center px-8 text-center text-white">
                <div>
                  <strong className="block text-xl">Snap expired</strong>
                  <p className="mt-2 text-sm text-white/65">This snap is no longer available.</p>
                </div>
              </div>
            ) : snap.attachment.mimeType?.startsWith("video/") ? (
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                src={snap.attachment.dataUrl}
                autoPlay
                playsInline
                controls={false}
                muted
              />
            ) : (
              <img
                className="h-full w-full object-cover"
                src={snap.attachment.dataUrl}
                alt={snap.attachment.name || "Snap"}
              />
            )}

            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent px-5 pb-6 pt-20 text-white">
              <strong className="block text-sm uppercase tracking-[0.18em] text-white/60">
                {snap.sender?.name || "Snap"}
              </strong>
              {snap.text ? <p className="mt-2 text-lg font-semibold tracking-tight">{snap.text}</p> : null}
              <span className="mt-3 block text-xs uppercase tracking-[0.18em] text-white/60">
                Tap to close. Swipe down to dismiss.
              </span>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(modal, document.body);
}
