import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getSnapFilter, SNAP_FILTERS } from "./SnapFilters";
import { useCamera } from "./hooks/useCamera";
import { useRecorder } from "./hooks/useRecorder";
import { useUpload } from "./hooks/useUpload";

type SnapPayload = {
  type: "snap";
  mediaUrl: string;
  thumbnail: string | null;
  duration: number;
  expiresAt: string;
  mimeType: string;
  fileName: string;
  size: number;
  caption: string;
};

type DraftState = {
  kind: "photo" | "video";
  blob: Blob;
  previewUrl: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
};

type Particle = {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  duration: number;
  delay: number;
};

type SnapCameraModalProps = {
  isOpen: boolean;
  recipientName?: string;
  onClose: () => void;
  onSendSnap: (payload: SnapPayload) => Promise<void>;
};

const moods = ["HAPPY VIBES ✨", "CHILL MODE 🌙", "FIRE TODAY 🔥", "GOOD ENERGY ⚡"];
const durationOptions = [1, 3, 5, 10];

function createParticles() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: index,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 3 + 1,
    color: ["#ff6fd8", "#c84bff", "#00f5ff", "#ffbe00"][Math.floor(Math.random() * 4)],
    duration: Math.random() * 4 + 3,
    delay: Math.random() * 3
  }));
}

function revokeDraft(draft: DraftState | null) {
  if (draft?.previewUrl) {
    URL.revokeObjectURL(draft.previewUrl);
  }
}

function formatFlashLabel(mode: "auto" | "on" | "off") {
  if (mode === "auto") {
    return "⚡ A";
  }

  if (mode === "on") {
    return "⚡ ON";
  }

  return "⚡ OFF";
}

export default function SnapCameraModal({
  isOpen,
  recipientName,
  onClose,
  onSendSnap
}: SnapCameraModalProps) {
  const previousDraftRef = useRef<DraftState | null>(null);
  const [mode, setMode] = useState<"photo" | "video">("photo");
  const [filterIndex, setFilterIndex] = useState(3);
  const [duration, setDuration] = useState(5);
  const [flashEffect, setFlashEffect] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [orbPulse, setOrbPulse] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [particles] = useState<Particle[]>(() => createParticles());
  const [mood] = useState(() => moods[Math.floor(Math.random() * moods.length)]);
  const streak = 7;

  const upload = useUpload();
  const camera = useCamera({
    enabled: isOpen && !draft && !sending && !sent,
    initialFacingMode: "user",
    initialFlashMode: "auto"
  });
  const activeFilter = SNAP_FILTERS[filterIndex] || SNAP_FILTERS[0];
  const flashColor =
    cameraFlashColorMap[camera.flashMode] || "rgba(255,255,255,0.25)";

  const recorder = useRecorder({
    maxDurationMs: 10_000,
    videoBitsPerSecond: 1_200_000,
    onRecordingComplete: ({ blob, previewUrl, durationMs, mimeType, fileName }) => {
      setDraft({
        kind: "video",
        blob,
        previewUrl,
        mimeType,
        fileName,
        durationMs
      });
      setError("");
      setOrbPulse(false);
    }
  });

  useEffect(() => {
    if (!isOpen) {
      revokeDraft(previousDraftRef.current);
      previousDraftRef.current = null;
      setDraft(null);
      setSending(false);
      setSent(false);
      setError("");
      setMode("photo");
      setDuration(5);
      setFilterIndex(3);
    }
  }, [isOpen]);

  useEffect(() => {
    if (previousDraftRef.current && previousDraftRef.current !== draft) {
      revokeDraft(previousDraftRef.current);
    }

    previousDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    return () => {
      revokeDraft(previousDraftRef.current);
    };
  }, []);

  const runtimeError = error || upload.error || recorder.error || camera.error;
  const countdown = Math.max(0, Math.ceil(recorder.remainingMs / 1000));
  const ringCircumference = 2 * Math.PI * 42;
  const ringProgress = ((10 - countdown) / 10) * ringCircumference;

  const previewStyle = useMemo(
    () => ({
      width: "100%",
      height: "100%",
      objectFit: "cover" as const,
      filter: activeFilter.css || "none",
      transform:
        !draft && camera.facingMode === "user"
          ? flipping
            ? "scaleX(0) scale(1.05)"
            : "scaleX(-1)"
          : flipping
            ? "scaleX(0) scale(1.05)"
            : "scaleX(1)",
      transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)"
    }),
    [activeFilter.css, camera.facingMode, draft, flipping]
  );

  function resetLocalState() {
    revokeDraft(previousDraftRef.current);
    previousDraftRef.current = null;
    setDraft(null);
    setSending(false);
    setSent(false);
    setError("");
    setFlashEffect(false);
    setOrbPulse(false);
  }

  function handleClose() {
    resetLocalState();
    onClose();
  }

  async function handleRetake() {
    revokeDraft(draft);
    setDraft(null);
    setSent(false);
    setError("");
    camera.restartCamera();
  }

  async function capturePhoto() {
    try {
      setFlashEffect(true);
      setOrbPulse(true);
      window.setTimeout(() => {
        setFlashEffect(false);
        setOrbPulse(false);
      }, 400);

      const result = await camera.capturePhoto();
      setDraft({
        kind: "photo",
        blob: result.blob,
        previewUrl: result.previewUrl,
        mimeType: result.mimeType,
        fileName: result.fileName,
        durationMs: duration * 1000
      });
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to capture photo.");
    }
  }

  function handleCapture() {
    if (mode === "photo") {
      void capturePhoto();
      return;
    }

    if (recorder.isRecording) {
      recorder.stopRecording();
      return;
    }

    if (!camera.streamRef.current) {
      setError("Camera preview is not ready yet.");
      return;
    }

    setOrbPulse(true);
    recorder.startRecording(camera.streamRef.current);
  }

  function handleFlipCamera() {
    setFlipping(true);
    window.setTimeout(() => {
      camera.flipCamera();
      window.setTimeout(() => setFlipping(false), 300);
    }, 150);
  }

  async function handleSend() {
    if (!draft) {
      return;
    }

    try {
      setSending(true);
      setError("");

      const result = await upload.uploadDraft({
        draft,
        filterId: activeFilter.id,
        caption: ""
      });

      await onSendSnap({
        type: "snap",
        mediaUrl: result.mediaUrl,
        thumbnail: result.thumbnailUrl,
        duration: result.duration,
        expiresAt: new Date(Date.now() + result.duration * 1000).toISOString(),
        mimeType: result.mimeType,
        fileName: result.fileName,
        size: result.size,
        caption: ""
      });

      setSent(true);
      window.setTimeout(() => {
        handleClose();
      }, 1600);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send snap.");
      setSending(false);
    }
  }

  const modal = (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/70 p-4"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2147483647,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.7)",
            isolation: "isolate"
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            aria-hidden="true"
            onClick={handleClose}
            style={{
              position: "absolute",
              inset: 0,
              background: "transparent",
              border: 0,
              padding: 0,
              margin: 0
            }}
          />
          <motion.div
            className="relative w-full overflow-hidden text-white"
            style={{
              position: "relative",
              zIndex: 2,
              width: "100%",
              maxWidth: 390,
              maxHeight: "96vh",
              overflow: "hidden",
              borderRadius: 36,
              border: "1.2px solid rgba(255,111,216,0.3)",
              background: "rgba(8,4,20,0.85)",
              backdropFilter: "blur(24px)",
              boxShadow:
                "0 50px 100px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.1)"
            }}
            initial={{ opacity: 0, scale: 0.92, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.28, ease: [0.34, 1.56, 0.64, 1] }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
              {[
                { left: "10%", top: "15%", width: 300, height: 250, color: "#ff6fd8", opacity: 0.07 },
                { left: "60%", top: "50%", width: 250, height: 220, color: "#c84bff", opacity: 0.06 },
                { left: "5%", top: "70%", width: 280, height: 200, color: "#00c8ff", opacity: 0.05 }
              ].map((blob, index) => (
                <div
                  key={index}
                  style={{
                    position: "absolute",
                    left: blob.left,
                    top: blob.top,
                    width: blob.width,
                    height: blob.height,
                    borderRadius: "50%",
                    background: `radial-gradient(ellipse, ${blob.color} 0%, transparent 70%)`,
                    opacity: blob.opacity,
                    filter: "blur(40px)"
                  }}
                />
              ))}
            </div>

            <div style={{ position: "relative", display: "flex", flexDirection: "column", padding: 16 }}>
              <canvas ref={camera.canvasRef} style={{ display: "none" }} />

              <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 4px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      position: "relative",
                      width: 38,
                      height: 38,
                      borderRadius: 12,
                      background: "linear-gradient(135deg,#ffbe00,#ff6fd8)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      boxShadow: "0 4px 16px rgba(255,190,0,0.4)"
                    }}
                  >
                    👻
                    <div
                      style={{
                        position: "absolute",
                        inset: -3,
                        borderRadius: 14,
                        background: "linear-gradient(135deg,#ffbe00,#ff6fd8)",
                        opacity: 0.3,
                        filter: "blur(6px)",
                        zIndex: -1
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span
                        style={{
                          color: "white",
                          fontWeight: 800,
                          fontSize: 17,
                          letterSpacing: "-0.5px",
                          textShadow: "0 0 20px rgba(255,111,216,0.4)"
                        }}
                      >
                        Snap
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.5)", fontWeight: 300, fontSize: 17 }}>
                        Camera
                      </span>
                    </div>
                    <div style={{ color: "rgba(255,111,216,0.8)", fontSize: 9, fontWeight: 600, letterSpacing: 1.5 }}>
                      {draft ? recipientName || "SNAP READY" : mood}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      background: "rgba(0,245,255,0.08)",
                      border: "1px solid rgba(0,245,255,0.2)",
                      borderRadius: 20,
                      padding: "5px 10px"
                    }}
                  >
                    <span style={{ fontSize: 14 }}>💎</span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "#00f5ff",
                        textShadow: "0 0 8px rgba(0,245,255,0.6)"
                      }}
                    >
                      {streak}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleClose}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: "50%",
                      background: "rgba(255,255,255,0.07)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "rgba(255,255,255,0.6)",
                      fontSize: 15,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    ✕
                  </button>
                </div>
              </header>

              <div style={{ display: "flex", justifyContent: "center", paddingBottom: 14 }}>
                <div
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    borderRadius: 50,
                    padding: 4,
                    display: "flex",
                    border: "1px solid rgba(255,255,255,0.07)"
                  }}
                >
                  {["photo", "video"].map((nextMode) => (
                    <button
                      key={nextMode}
                      type="button"
                      onClick={() => setMode(nextMode as "photo" | "video")}
                      style={{
                        padding: "8px 24px",
                        borderRadius: 50,
                        border: "none",
                        background:
                          mode === nextMode
                            ? "linear-gradient(135deg,#ff6fd8,#c84bff)"
                            : "transparent",
                        color: mode === nextMode ? "white" : "rgba(255,255,255,0.35)",
                        fontFamily: "inherit",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                        transition: "all 0.3s",
                        boxShadow:
                          mode === nextMode ? "0 4px 20px rgba(200,75,255,0.5)" : "none",
                        textTransform: "capitalize"
                      }}
                    >
                      {nextMode === "video" ? "10s Video" : "Photo"}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ position: "relative", padding: "0 0 14px" }}>
                <div
                  style={{
                    position: "absolute",
                    inset: 4,
                    borderRadius: 24,
                    background: "linear-gradient(135deg,#ff6fd8,#c84bff,#00c8ff,#ffbe00)",
                    opacity: 0.5
                  }}
                >
                  <div style={{ width: "100%", height: "100%", borderRadius: 22, background: "transparent" }} />
                </div>

                <div
                  style={{
                    position: "relative",
                    borderRadius: 22,
                    overflow: "hidden",
                    aspectRatio: "4/5",
                    background: "linear-gradient(180deg,#0d0520 0%,#050308 100%)",
                    border: "1.5px solid rgba(255,111,216,0.3)",
                    boxShadow: "0 0 40px rgba(255,111,216,0.15), inset 0 0 60px rgba(0,0,0,0.5)"
                  }}
                >
                  {draft ? (
                    draft.kind === "photo" ? (
                      <img src={draft.previewUrl} alt="Snap preview" style={previewStyle} />
                    ) : (
                      <video src={draft.previewUrl} autoPlay loop muted playsInline style={previewStyle} />
                    )
                  ) : camera.isReady ? (
                    <video ref={camera.videoRef} autoPlay muted playsInline style={previewStyle} />
                  ) : runtimeError ? (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 14,
                        padding: 32
                      }}
                    >
                      <div
                        style={{
                          fontSize: 56,
                          animation: "snap-lock-pulse 2s infinite",
                          filter: "drop-shadow(0 0 16px rgba(255,111,216,0.7))"
                        }}
                      >
                        🔒
                      </div>
                      <div
                        style={{
                          color: "white",
                          fontWeight: 800,
                          fontSize: 18,
                          textAlign: "center",
                          textShadow: "0 0 20px rgba(255,111,216,0.4)"
                        }}
                      >
                        Camera Access Needed
                      </div>
                      <div
                        style={{
                          color: "rgba(255,255,255,0.4)",
                          fontSize: 13,
                          textAlign: "center",
                          lineHeight: 1.7
                        }}
                      >
                        {runtimeError}
                      </div>
                      <button
                        type="button"
                        onClick={camera.restartCamera}
                        style={{
                          padding: "12px 28px",
                          borderRadius: 50,
                          background: "linear-gradient(135deg,#ff6fd8,#c84bff)",
                          border: "none",
                          color: "white",
                          fontFamily: "inherit",
                          fontSize: 13,
                          fontWeight: 700,
                          cursor: "pointer",
                          boxShadow: "0 8px 25px rgba(255,111,216,0.5)"
                        }}
                      >
                        🔓 Allow Camera
                      </button>
                    </div>
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "column",
                        gap: 12
                      }}
                    >
                      <div style={{ fontSize: 32, animation: "snap-spin 2s linear infinite" }}>⚙️</div>
                      <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Starting camera...</div>
                    </div>
                  )}

                  {particles.map((particle) => (
                    <div
                      key={particle.id}
                      style={{
                        position: "absolute",
                        left: `${particle.x}%`,
                        top: `${particle.y}%`,
                        width: particle.size,
                        height: particle.size,
                        borderRadius: "50%",
                        background: particle.color,
                        opacity: 0.5,
                        pointerEvents: "none",
                        animation: `snap-float ${particle.duration}s ${particle.delay}s infinite alternate ease-in-out`
                      }}
                    />
                  ))}

                  {[33, 66].map((offset) => (
                    <div
                      key={`vertical-${offset}`}
                      style={{
                        position: "absolute",
                        left: `${offset}%`,
                        top: 0,
                        bottom: 0,
                        width: 1,
                        background: "rgba(255,255,255,0.04)"
                      }}
                    />
                  ))}
                  {[33, 66].map((offset) => (
                    <div
                      key={`horizontal-${offset}`}
                      style={{
                        position: "absolute",
                        top: `${offset}%`,
                        left: 0,
                        right: 0,
                        height: 1,
                        background: "rgba(255,255,255,0.04)"
                      }}
                    />
                  ))}

                  {[
                    { top: 14, left: 14, borderTop: true, borderLeft: true },
                    { top: 14, right: 14, borderTop: true, borderRight: true },
                    { bottom: 14, left: 14, borderBottom: true, borderLeft: true },
                    { bottom: 14, right: 14, borderBottom: true, borderRight: true }
                  ].map((corner, index) => (
                    <div
                      key={index}
                      style={{
                        position: "absolute",
                        width: 20,
                        height: 20,
                        top: corner.top,
                        right: corner.right,
                        bottom: corner.bottom,
                        left: corner.left,
                        borderTop: corner.borderTop ? "2px solid" : "none",
                        borderBottom: corner.borderBottom ? "2px solid" : "none",
                        borderLeft: corner.borderLeft ? "2px solid" : "none",
                        borderRight: corner.borderRight ? "2px solid" : "none",
                        borderColor:
                          index < 2 ? "rgba(255,111,216,0.7)" : "rgba(0,245,255,0.7)",
                        filter: "drop-shadow(0 0 3px currentColor)"
                      }}
                    />
                  ))}

                  {flashEffect ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "white",
                        opacity: 0.9,
                        animation: "snap-flash-out 0.35s forwards",
                        borderRadius: 22
                      }}
                    />
                  ) : null}

                  {recorder.isRecording ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 14,
                        left: 14,
                        background: "rgba(220,30,30,0.9)",
                        borderRadius: 8,
                        padding: "4px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        backdropFilter: "blur(8px)",
                        boxShadow: "0 0 12px rgba(255,0,0,0.4)"
                      }}
                    >
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: "white",
                          animation: "snap-blink 0.8s infinite"
                        }}
                      />
                      <span style={{ color: "white", fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>
                        REC
                      </span>
                      <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 10, fontWeight: 600 }}>
                        {countdown}s
                      </span>
                    </div>
                  ) : null}

                  {!draft ? (
                    <>
                      <button
                        type="button"
                        onClick={camera.cycleFlashMode}
                        style={{
                          position: "absolute",
                          top: 14,
                          left: recorder.isRecording ? 82 : 14,
                          background: "rgba(0,0,0,0.55)",
                          backdropFilter: "blur(10px)",
                          border: `1px solid ${flashColor}40`,
                          borderRadius: 10,
                          padding: "6px 12px",
                          color: flashColor,
                          fontFamily: "inherit",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          transition: "all 0.2s"
                        }}
                      >
                        {formatFlashLabel(camera.flashMode)}
                      </button>

                      <button
                        type="button"
                        onClick={handleFlipCamera}
                        style={{
                          position: "absolute",
                          top: 14,
                          right: 14,
                          background: "rgba(0,0,0,0.55)",
                          backdropFilter: "blur(10px)",
                          border: "1px solid rgba(0,245,255,0.3)",
                          borderRadius: 12,
                          width: 40,
                          height: 40,
                          cursor: "pointer",
                          fontSize: 18,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 0.3s",
                          color: "#00f5ff",
                          opacity: camera.hasMultipleCameras ? 1 : 0.5
                        }}
                        disabled={!camera.hasMultipleCameras}
                      >
                        🔄
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleRetake()}
                        style={{
                          position: "absolute",
                          top: 14,
                          left: 14,
                          background: "rgba(0,0,0,0.6)",
                          backdropFilter: "blur(10px)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: 12,
                          padding: "8px 16px",
                          color: "white",
                          fontFamily: "inherit",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer"
                        }}
                      >
                        ← Retake
                      </button>

                      {draft.kind === "photo" ? (
                        <div
                          style={{
                            position: "absolute",
                            top: 14,
                            right: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 6
                          }}
                        >
                          <div
                            style={{
                              color: "rgba(255,255,255,0.4)",
                              fontSize: 9,
                              fontWeight: 600,
                              textAlign: "center",
                              letterSpacing: 1
                            }}
                          >
                            TIMER
                          </div>
                          {durationOptions.map((value) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setDuration(value)}
                              style={{
                                width: 34,
                                height: 28,
                                borderRadius: 8,
                                background:
                                  duration === value
                                    ? "linear-gradient(135deg,#ff6fd8,#c84bff)"
                                    : "rgba(0,0,0,0.5)",
                                border:
                                  duration === value
                                    ? "none"
                                    : "1px solid rgba(255,255,255,0.15)",
                                color: "white",
                                fontFamily: "inherit",
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: "pointer",
                                boxShadow:
                                  duration === value ? "0 0 10px rgba(255,111,216,0.4)" : "none"
                              }}
                            >
                              {value}s
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </>
                  )}

                  {!draft ? (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 12,
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: "rgba(0,0,0,0.5)",
                        backdropFilter: "blur(10px)",
                        border: "1px solid rgba(255,111,216,0.25)",
                        borderRadius: 20,
                        padding: "4px 14px"
                      }}
                    >
                      <span style={{ color: "rgba(255,111,216,0.8)", fontSize: 9, fontWeight: 600, letterSpacing: 1.5 }}>
                        {mood}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {!draft ? (
                <div style={{ padding: "14px 0 8px", position: "relative" }}>
                  <div
                    style={{
                      color: "rgba(255,255,255,0.25)",
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 2,
                      textAlign: "center",
                      marginBottom: 10
                    }}
                  >
                    ● FILTERS ●
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      padding: "0 8px",
                      overflowX: "auto",
                      scrollbarWidth: "none"
                    }}
                  >
                    <SnapFilters
                      selectedId={activeFilter.id}
                      onSelect={(filterId) => {
                        const nextIndex = SNAP_FILTERS.findIndex((filter) => filter.id === filterId);
                        if (nextIndex >= 0) {
                          setFilterIndex(nextIndex);
                        }
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 10 }}>
                    {SNAP_FILTERS.map((filter, index) => (
                      <div
                        key={filter.id}
                        style={{
                          width: index === filterIndex ? 16 : 5,
                          height: 5,
                          borderRadius: 3,
                          background:
                            index === filterIndex
                              ? "linear-gradient(90deg,#ff6fd8,#c84bff)"
                              : "rgba(255,255,255,0.2)",
                          transition: "all 0.3s ease",
                          boxShadow:
                            index === filterIndex ? "0 0 8px rgba(255,111,216,0.5)" : "none"
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              <div style={{ padding: "16px 20px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                {!draft ? (
                  <>
                    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {[80, 66, 54].map((radius, index) => (
                        <div
                          key={index}
                          style={{
                            position: "absolute",
                            width: radius * 2,
                            height: radius * 2,
                            borderRadius: "50%",
                            border: `${index === 0 ? 0.8 : 1}px solid`,
                            borderColor:
                              index === 0
                                ? "rgba(255,111,216,0.1)"
                                : index === 1
                                  ? "rgba(200,75,255,0.15)"
                                  : "rgba(255,111,216,0.2)",
                            animation: `snap-pulse-${index} ${3 + index * 0.5}s infinite ease-in-out`,
                            pointerEvents: "none"
                          }}
                        />
                      ))}

                      <svg width={100} height={100} style={{ position: "absolute" }}>
                        <defs>
                          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#ff6fd8" />
                            <stop offset="100%" stopColor="#c84bff" />
                          </linearGradient>
                        </defs>
                        <circle
                          cx={50}
                          cy={50}
                          r={42}
                          fill="none"
                          stroke="rgba(255,255,255,0.08)"
                          strokeWidth={3}
                        />
                        {recorder.isRecording ? (
                          <circle
                            cx={50}
                            cy={50}
                            r={42}
                            fill="none"
                            stroke="url(#ringGrad)"
                            strokeWidth={3}
                            strokeDasharray={ringCircumference}
                            strokeDashoffset={ringCircumference - ringProgress}
                            strokeLinecap="round"
                            transform="rotate(-90 50 50)"
                            style={{ transition: "stroke-dashoffset 1s linear" }}
                          />
                        ) : null}
                      </svg>

                      <button
                        type="button"
                        onClick={handleCapture}
                        disabled={!camera.isReady && !draft}
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: "50%",
                          background: recorder.isRecording
                            ? "radial-gradient(circle at 40% 35%, #ff6060, #cc0000)"
                            : "radial-gradient(circle at 40% 35%, #ffffff, #ff9fe8 40%, #7b00ff)",
                          border: "3px solid rgba(255,255,255,0.15)",
                          cursor: "pointer",
                          boxShadow: orbPulse
                            ? "0 0 60px rgba(255,255,255,0.8), 0 0 30px rgba(255,111,216,0.8)"
                            : recorder.isRecording
                              ? "0 0 30px rgba(255,50,50,0.7)"
                              : "0 0 30px rgba(255,111,216,0.6), 0 0 60px rgba(200,75,255,0.2)",
                          transition: "all 0.3s",
                          position: "relative",
                          overflow: "hidden",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: recorder.isRecording ? 24 : 0,
                          opacity: camera.isReady ? 1 : 0.5
                        }}
                      >
                        {recorder.isRecording ? "⏹" : null}
                        {!recorder.isRecording ? (
                          <div
                            style={{
                              position: "absolute",
                              top: "18%",
                              left: "20%",
                              width: "35%",
                              height: "25%",
                              borderRadius: "50%",
                              background: "rgba(255,255,255,0.5)"
                            }}
                          />
                        ) : null}
                      </button>
                    </div>

                    <div
                      style={{
                        color: "rgba(255,255,255,0.25)",
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: 2
                      }}
                    >
                      {mode === "video" && recorder.isRecording
                        ? `RECORDING • ${countdown}s`
                        : "TAP TO CAPTURE"}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || sent}
                    style={{
                      width: "100%",
                      padding: "16px",
                      borderRadius: 50,
                      background: sent
                        ? "linear-gradient(135deg,#00c875,#00a86b)"
                        : "linear-gradient(135deg,#ff6fd8,#c84bff,#7b2fff)",
                      border: "none",
                      color: "white",
                      fontFamily: "inherit",
                      fontSize: 15,
                      fontWeight: 800,
                      cursor: "pointer",
                      letterSpacing: 0.5,
                      transform: sent ? "scale(0.96)" : "scale(1)",
                      transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
                      boxShadow: sent
                        ? "0 8px 30px rgba(0,200,117,0.5)"
                        : "0 8px 40px rgba(255,111,216,0.5), 0 0 80px rgba(200,75,255,0.2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                      position: "relative",
                      overflow: "hidden",
                      opacity: sending && !sent ? 0.8 : 1
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        height: "50%",
                        background: "rgba(255,255,255,0.08)",
                        borderRadius: "50px 50px 0 0"
                      }}
                    />
                    {sent
                      ? "✓ Snap Sent! 🎉"
                      : sending
                        ? "Sending..."
                        : `Send Snap ✈  •  ${draft.kind === "video" ? "10s" : `${duration}s`}`}
                  </button>
                )}

                {runtimeError && !draft ? (
                  <div
                    style={{
                      maxWidth: "100%",
                      color: "rgba(255,255,255,0.52)",
                      fontSize: 12,
                      textAlign: "center"
                    }}
                  >
                    {runtimeError}
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>

          <style>{`
            @keyframes snap-lock-pulse { 0%,100%{opacity:1;filter:drop-shadow(0 0 16px rgba(255,111,216,0.7))} 50%{opacity:0.6;filter:drop-shadow(0 0 8px rgba(255,111,216,0.3))} }
            @keyframes snap-blink { 0%,100%{opacity:1} 50%{opacity:0} }
            @keyframes snap-flash-out { from{opacity:0.9} to{opacity:0} }
            @keyframes snap-float { from{transform:translateY(0px)} to{transform:translateY(-8px)} }
            @keyframes snap-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
            @keyframes snap-pulse-0 { 0%,100%{opacity:0.4;transform:scale(1)} 50%{opacity:0.1;transform:scale(1.05)} }
            @keyframes snap-pulse-1 { 0%,100%{opacity:0.3;transform:scale(1)} 50%{opacity:0.08;transform:scale(1.04)} }
            @keyframes snap-pulse-2 { 0%,100%{opacity:0.5;transform:scale(1)} 50%{opacity:0.15;transform:scale(1.03)} }
          `}</style>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(modal, document.body);
}

const cameraFlashColorMap: Record<string, string> = {
  auto: "white",
  on: "#ffbe00",
  off: "rgba(255,255,255,0.25)"
};
