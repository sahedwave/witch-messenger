import { useEffect, useRef, useState } from "react";

export type CameraFacingMode = "user" | "environment";
export type FlashMode = "auto" | "on" | "off";

type UseCameraOptions = {
  enabled: boolean;
  initialFacingMode?: CameraFacingMode;
  initialFlashMode?: FlashMode;
};

function getMediaErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Camera access was not granted.";
}

export function useCamera({
  enabled,
  initialFacingMode = "user",
  initialFlashMode = "auto"
}: UseCameraOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastWorkingFacingModeRef = useRef<CameraFacingMode>(initialFacingMode);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState("");
  const [facingMode, setFacingMode] = useState<CameraFacingMode>(initialFacingMode);
  const [flashMode, setFlashMode] = useState<FlashMode>(initialFlashMode);
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);

  function stopCurrentStream() {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function applyTorchMode(nextFlashMode: FlashMode) {
    const track = streamRef.current?.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;

    if (!track || !capabilities?.torch) {
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: nextFlashMode === "on" }]
      });
    } catch {
      // Torch is optional and unsupported on many browsers.
    }
  }

  async function startCameraSession() {
    return startCameraSessionForMode(facingMode, false);
  }

  async function startCameraSessionForMode(
    requestedFacingMode: CameraFacingMode,
    keepCurrentFacingModeOnFailure = false
  ) {
    setIsRequesting(true);

    try {
      setError("");
      setIsReady(false);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera is not supported on this device.");
      }

      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setHasMultipleCameras(
        devices.filter((device) => device.kind === "videoinput").length > 1
      );

      stopCurrentStream();

      let stream: MediaStream;

      try {
        // Prefer an exact facing mode when flipping so the browser actually switches cameras.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { exact: requestedFacingMode },
            width: { ideal: 720 },
            height: { ideal: 1280 }
          }
        });
      } catch {
        // Fall back to ideal for browsers/devices that do not support exact facing constraints.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: requestedFacingMode },
            width: { ideal: 720 },
            height: { ideal: 1280 }
          }
        });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => null);
      }

      await applyTorchMode(flashMode);
      lastWorkingFacingModeRef.current = requestedFacingMode;
      setFacingMode(requestedFacingMode);
      setIsReady(true);
      return true;
    } catch (nextError) {
      setError(getMediaErrorMessage(nextError));
      if (!keepCurrentFacingModeOnFailure) {
        setFacingMode(lastWorkingFacingModeRef.current);
      }
      setIsReady(false);
      return false;
    } finally {
      setIsRequesting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setIsReady(false);
      setError("");
      stopCurrentStream();
      return undefined;
    }

    async function run() {
      const success = await startCameraSession();

      if (cancelled && success) {
        stopCurrentStream();
      }
    }

    void run();

    return () => {
      cancelled = true;
      stopCurrentStream();
    };
  }, [enabled, facingMode, restartToken]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void applyTorchMode(flashMode);
  }, [enabled, flashMode]);

  async function capturePhoto() {
    const video = videoRef.current;

    if (!video || !streamRef.current || !video.videoWidth || !video.videoHeight) {
      throw new Error("Camera preview is not ready yet.");
    }

    const canvas = canvasRef.current || document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Unable to capture photo.");
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    if (facingMode === "user") {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => {
          if (!value) {
            reject(new Error("Unable to capture photo."));
            return;
          }

          resolve(value);
        },
        "image/jpeg",
        0.92
      );
    });

    return {
      blob,
      previewUrl: URL.createObjectURL(blob),
      mimeType: blob.type || "image/jpeg",
      fileName: `snap-${Date.now()}.jpg`
    };
  }

  function flipCamera() {
    if (isRequesting) {
      return;
    }

    setIsFlipping(true);

    const nextFacingMode =
      lastWorkingFacingModeRef.current === "user" ? "environment" : "user";

    void (async () => {
      const success = await startCameraSessionForMode(nextFacingMode, true);

      if (!success && nextFacingMode !== lastWorkingFacingModeRef.current) {
        await startCameraSessionForMode(lastWorkingFacingModeRef.current, true);
      }

      window.setTimeout(() => {
        setIsFlipping(false);
      }, 320);
    })();
  }

  function cycleFlashMode() {
    setFlashMode((current) => {
      if (current === "auto") {
        return "on";
      }

      if (current === "on") {
        return "off";
      }

      return "auto";
    });
  }

  return {
    videoRef,
    streamRef,
    canvasRef,
    isReady,
    isRequesting,
    error,
    facingMode,
    flashMode,
    hasMultipleCameras,
    isFlipping,
    setError,
    capturePhoto,
    cycleFlashMode,
    flipCamera,
    requestCamera: startCameraSession,
    stopCamera: stopCurrentStream,
    restartCamera: () => setRestartToken((current) => current + 1)
  };
}
