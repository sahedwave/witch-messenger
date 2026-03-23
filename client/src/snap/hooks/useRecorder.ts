import { useEffect, useRef, useState } from "react";

type RecordingResult = {
  blob: Blob;
  previewUrl: string;
  durationMs: number;
  mimeType: string;
  fileName: string;
};

type UseRecorderOptions = {
  maxDurationMs?: number;
  videoBitsPerSecond?: number;
  onRecordingComplete?: (result: RecordingResult) => void;
};

function getRecorderMimeType() {
  const supportedMimeTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];

  return supportedMimeTypes.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

export function useRecorder({
  maxDurationMs = 10_000,
  videoBitsPerSecond = 1_200_000,
  onRecordingComplete
}: UseRecorderOptions = {}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState("");

  function clearTimers() {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      clearTimers();
      if (recorderRef.current?.state !== "inactive") {
        recorderRef.current?.stop();
      }
    };
  }, []);

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }

  function startRecording(stream: MediaStream) {
    try {
      setError("");
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined,
        videoBitsPerSecond
      });

      recorderRef.current = recorder;
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      setIsRecording(true);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearTimers();
        setIsRecording(false);
        const durationMs = Date.now() - startedAtRef.current;
        setElapsedMs(durationMs);

        const outputMimeType = recorder.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type: outputMimeType });
        const previewUrl = URL.createObjectURL(blob);
        onRecordingComplete?.({
          blob,
          previewUrl,
          durationMs,
          mimeType: outputMimeType,
          fileName: `snap-${Date.now()}.webm`
        });
      };

      recorder.start(250);

      intervalRef.current = window.setInterval(() => {
        setElapsedMs(Date.now() - startedAtRef.current);
      }, 250);

      timeoutRef.current = window.setTimeout(() => {
        stopRecording();
      }, maxDurationMs);

      return true;
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Unable to start video recording."
      );
      setIsRecording(false);
      clearTimers();
      return false;
    }
  }

  return {
    isRecording,
    elapsedMs,
    remainingMs: Math.max(0, maxDurationMs - elapsedMs),
    error,
    startRecording,
    stopRecording
  };
}
