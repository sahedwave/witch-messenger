import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

type SnapCaptureButtonProps = {
  disabled?: boolean;
  isRecording?: boolean;
  onTap: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
};

const HOLD_DELAY_MS = 180;

export default function SnapCaptureButton({
  disabled = false,
  isRecording = false,
  onTap,
  onHoldStart,
  onHoldEnd
}: SnapCaptureButtonProps) {
  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const [isPressed, setIsPressed] = useState(false);

  useEffect(() => {
    return () => {
      if (holdTimerRef.current) {
        window.clearTimeout(holdTimerRef.current);
      }
    };
  }, []);

  function clearHoldTimer() {
    if (holdTimerRef.current) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }

  function handlePointerDown() {
    if (disabled) {
      return;
    }

    setIsPressed(true);
    holdTriggeredRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTriggeredRef.current = true;
      onHoldStart();
    }, HOLD_DELAY_MS);
  }

  function handlePointerUp() {
    if (disabled) {
      return;
    }

    const didHold = holdTriggeredRef.current || isRecording;
    clearHoldTimer();
    setIsPressed(false);

    if (didHold) {
      holdTriggeredRef.current = false;
      onHoldEnd();
      return;
    }

    onTap();
  }

  function handlePointerCancel() {
    clearHoldTimer();
    setIsPressed(false);

    if (holdTriggeredRef.current || isRecording) {
      holdTriggeredRef.current = false;
      onHoldEnd();
    }
  }

  return (
    <motion.button
      type="button"
      aria-label={isRecording ? "Stop recording" : "Capture snap"}
      disabled={disabled}
      whileHover={{ scale: disabled ? 1 : 1.04 }}
      animate={{ scale: isPressed ? 0.95 : 1 }}
      className="relative flex h-24 w-24 items-center justify-center rounded-full bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      style={{
        position: "relative",
        display: "flex",
        width: 96,
        height: 96,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        background: "rgba(255,255,255,0.1)",
        opacity: disabled ? 0.4 : 1
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerCancel}
      onPointerCancel={handlePointerCancel}
    >
      {isRecording ? (
        <motion.span
          className="absolute inset-0 rounded-full border border-rose-300/60"
          animate={{ scale: [1, 1.12, 1], opacity: [0.7, 0.1, 0.7] }}
          transition={{ repeat: Infinity, duration: 1.15 }}
          style={{ position: "absolute", inset: 0, borderRadius: 999, border: "1px solid rgba(253,164,175,0.6)" }}
          aria-hidden="true"
        />
      ) : null}
      <span
        className={`absolute inset-[10px] rounded-full border ${
          isRecording ? "border-rose-200/80" : "border-white/70"
        }`}
        style={{
          position: "absolute",
          inset: 10,
          borderRadius: 999,
          border: isRecording ? "1px solid rgba(254,205,211,0.8)" : "1px solid rgba(255,255,255,0.7)"
        }}
        aria-hidden="true"
      />
      <motion.span
        className={`relative h-14 w-14 rounded-full ${
          isRecording ? "bg-rose-500" : "bg-white"
        }`}
        animate={isRecording ? { scale: [1, 0.86, 1] } : { scale: 1 }}
        transition={isRecording ? { repeat: Infinity, duration: 0.9 } : undefined}
        style={{
          position: "relative",
          width: 56,
          height: 56,
          borderRadius: 999,
          background: isRecording ? "#f43f5e" : "#ffffff"
        }}
        aria-hidden="true"
      />
    </motion.button>
  );
}
