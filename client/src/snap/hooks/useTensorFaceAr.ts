import { useCallback, useEffect, useRef, useState } from "react";

import { AR_FILTERS, type ArFilterId, drawArFilter } from "../arFilters";
import {
  SNAP_CAMERA_HEIGHT,
  SNAP_CAMERA_WIDTH,
  SNAP_DETECTION_INTERVAL_MS,
  SNAP_MAX_DURATION_MS,
  SNAP_MAX_DURATION_SECONDS,
  SNAP_VIDEO_BITS_PER_SECOND,
  SNAP_VIDEO_FRAME_RATE
} from "../constants";

type CaptureResult = {
  blob: Blob;
  previewUrl: string;
  mimeType: string;
  fileName: string;
};

type UseTensorFaceArOptions = {
  enabled: boolean;
};

type TensorModule = Awaited<typeof import("@tensorflow/tfjs")>;
type FaceLandmarksModule = Awaited<
  typeof import("@tensorflow-models/face-landmarks-detection")
>;

let sharedArModulePromise: Promise<{
  tf: TensorModule;
  faceLandmarksDetection: FaceLandmarksModule;
}> | null = null;

type PermissionState = "prompt" | "granted" | "denied";
type EngineState = "idle" | "loading" | "ready" | "unsupported" | "failed";
type FacingMode = "user" | "environment";

function isBrowserSupported() {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof HTMLCanvasElement !== "undefined" &&
    typeof window.requestAnimationFrame !== "undefined"
  );
}

function getMediaErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Camera access was not granted.";
}

function getRecordingMimeType() {
  const supportedMimeTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4"
  ];

  return supportedMimeTypes.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

export function useTensorFaceAr({ enabled }: UseTensorFaceArOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const tfModuleRef = useRef<TensorModule | null>(null);
  const faceLandmarksModuleRef = useRef<FaceLandmarksModule | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastFacesRef = useRef<any[] | null>(null);
  const detectionInFlightRef = useRef(false);
  const lastDetectionAtRef = useRef(0);
  const lastFaceSeenAtRef = useRef(0);
  const faceDetectedRef = useRef(false);
  const activeFilterRef = useRef<ArFilterId>("soft-beauty");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<number | null>(null);
  const flipInFlightRef = useRef(false);
  const lastWorkingFacingModeRef = useRef<FacingMode>("user");
  const [engineState, setEngineState] = useState<EngineState>(
    isBrowserSupported() ? "idle" : "unsupported"
  );
  const [permission, setPermission] = useState<PermissionState>("prompt");
  const [activeFilter, setActiveFilter] = useState<ArFilterId>("soft-beauty");
  const [error, setError] = useState(
    isBrowserSupported() ? "" : "Please use Chrome or Safari for AR filters"
  );
  const [flashMode, setFlashMode] = useState<"auto" | "on" | "off">("auto");
  const [hasTorch, setHasTorch] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState(SNAP_MAX_DURATION_SECONDS);
  const [loadingFilterId, setLoadingFilterId] = useState<string>("");
  const [isWindowActive, setIsWindowActive] = useState(true);
  const [faceDetected, setFaceDetected] = useState(false);

  const loadArModules = useCallback(async () => {
    if (!sharedArModulePromise) {
      sharedArModulePromise = Promise.all([
        import("@tensorflow/tfjs"),
        import("@tensorflow-models/face-landmarks-detection")
      ]).then(([tf, faceLandmarksDetection]) => ({
        tf,
        faceLandmarksDetection
      }));
    }

    if (!tfModuleRef.current || !faceLandmarksModuleRef.current) {
      const modules = await sharedArModulePromise;
      tfModuleRef.current = modules.tf;
      faceLandmarksModuleRef.current = modules.faceLandmarksDetection;
    }

    return {
      tf: tfModuleRef.current,
      faceLandmarksDetection: faceLandmarksModuleRef.current
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return undefined;
    }

    function updateWindowActivity() {
      setIsWindowActive(document.visibilityState === "visible");
    }

    updateWindowActivity();
    document.addEventListener("visibilitychange", updateWindowActivity);

    return () => {
      document.removeEventListener("visibilitychange", updateWindowActivity);
    };
  }, []);

  const stopCurrentStream = useCallback(() => {
    if (!streamRef.current) {
      return;
    }

    streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const cancelRenderLoop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const disposeDetector = useCallback(() => {
    detectorRef.current?.dispose();
    detectorRef.current = null;
  }, []);

  const applyTorchMode = useCallback(
    async (nextFlashMode: "auto" | "on" | "off") => {
      const track = streamRef.current?.getVideoTracks?.()[0];
      const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
      const torchSupported = Boolean(capabilities?.torch);

      setHasTorch(torchSupported);

      if (!track || !torchSupported) {
        if (nextFlashMode !== "auto") {
          setFlashMode("auto");
        }
        return;
      }

      try {
        await track.applyConstraints({
          advanced: [{ torch: nextFlashMode === "on" }]
        });
      } catch {
        setHasTorch(false);
      }
    },
    []
  );

  const startCamera = useCallback(
    async (nextFacingMode: FacingMode, keepFacingOnFailure = false) => {
      try {
        setPermission("prompt");
        setError("");
        setHasTorch(false);
        stopCurrentStream();

        let stream: MediaStream;

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { exact: nextFacingMode },
              width: { ideal: SNAP_CAMERA_WIDTH },
              height: { ideal: SNAP_CAMERA_HEIGHT },
              frameRate: { ideal: SNAP_VIDEO_FRAME_RATE, max: SNAP_VIDEO_FRAME_RATE }
            }
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              facingMode: { ideal: nextFacingMode },
              width: { ideal: SNAP_CAMERA_WIDTH },
              height: { ideal: SNAP_CAMERA_HEIGHT },
              frameRate: { ideal: SNAP_VIDEO_FRAME_RATE, max: SNAP_VIDEO_FRAME_RATE }
            }
          });
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        await applyTorchMode(flashMode);
        lastWorkingFacingModeRef.current = nextFacingMode;
        setFacingMode(nextFacingMode);
        setPermission("granted");
        return true;
      } catch (nextError) {
        setPermission("denied");
        setError(getMediaErrorMessage(nextError));
        setHasTorch(false);
        if (!keepFacingOnFailure) {
          setFacingMode(lastWorkingFacingModeRef.current);
        }
        return false;
      }
    },
    [applyTorchMode, flashMode, stopCurrentStream]
  );

  const renderLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      return;
    }

    if (!video.videoWidth || !video.videoHeight) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
      return;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const activeFilterConfig =
      AR_FILTERS.find((filter) => filter.id === activeFilterRef.current) || AR_FILTERS[0];

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = activeFilterConfig.filter;
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    const now = performance.now();
    const faces = lastFacesRef.current || [];

    if (
      isWindowActive &&
      detectorRef.current &&
      !detectionInFlightRef.current &&
      now - lastDetectionAtRef.current >= SNAP_DETECTION_INTERVAL_MS
    ) {
      detectionInFlightRef.current = true;
      lastDetectionAtRef.current = now;

      void detectorRef.current
        .estimateFaces(video, {
          flipHorizontal: true
        })
        .then((nextFaces) => {
          lastFacesRef.current = nextFaces;
          if (nextFaces.length > 0) {
            lastFaceSeenAtRef.current = performance.now();
            if (!faceDetectedRef.current) {
              faceDetectedRef.current = true;
              setFaceDetected(true);
            }
            return;
          }

          if (faceDetectedRef.current && performance.now() - lastFaceSeenAtRef.current > 450) {
            faceDetectedRef.current = false;
            setFaceDetected(false);
          }
        })
        .catch((nextError) => {
          console.warn("Face tracking frame failed.", nextError);
        })
        .finally(() => {
          detectionInFlightRef.current = false;
        });
    }

    if (faces.length > 0) {
      drawArFilter(ctx, faces[0].keypoints, canvas.width, canvas.height, activeFilterRef.current, now);
    }

    animationFrameRef.current = requestAnimationFrame(renderLoop);
  }, [isWindowActive]);

  const initDetector = useCallback(async () => {
    try {
      setEngineState("loading");
      setError("");
      disposeDetector();
      const { tf, faceLandmarksDetection } = await loadArModules();
      await tf.ready();
      if (tf.getBackend() !== "webgl") {
        try {
          await tf.setBackend("webgl");
          await tf.ready();
        } catch (backendError) {
          console.warn("Unable to switch TensorFlow backend to webgl.", backendError);
        }
      }

      const detector = await faceLandmarksDetection.createDetector(
        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        {
          runtime: "tfjs",
          refineLandmarks: false,
          maxFaces: 1
        }
      );

      detectorRef.current = detector;
      setEngineState("ready");
      cancelRenderLoop();
      detectionInFlightRef.current = false;
      lastFacesRef.current = null;
      lastDetectionAtRef.current = 0;
      lastFaceSeenAtRef.current = 0;
      faceDetectedRef.current = false;
      setFaceDetected(false);
      if (isWindowActive) {
        animationFrameRef.current = requestAnimationFrame(renderLoop);
      }
    } catch (nextError) {
      console.warn("TensorFlow AR initialization failed.", nextError);
      setEngineState("failed");
      setError("AR filters unavailable");
    }
  }, [cancelRenderLoop, disposeDetector, isWindowActive, loadArModules, renderLoop]);

  useEffect(() => {
    if (!enabled || !streamRef.current) {
      return;
    }

    void applyTorchMode(flashMode);
  }, [applyTorchMode, enabled, flashMode]);

  useEffect(() => {
    if (!enabled) {
      cancelRenderLoop();
      stopRecording();
      stopCurrentStream();
      disposeDetector();
      setEngineState(isBrowserSupported() ? "idle" : "unsupported");
      detectionInFlightRef.current = false;
      lastFacesRef.current = null;
      lastFaceSeenAtRef.current = 0;
      faceDetectedRef.current = false;
      setFaceDetected(false);
      setHasTorch(false);
      setCountdown(SNAP_MAX_DURATION_SECONDS);
      return undefined;
    }

    if (!isBrowserSupported()) {
      setEngineState("unsupported");
      setError("Please use Chrome or Safari for AR filters");
      return undefined;
    }

    let cancelled = false;

    async function boot() {
      const cameraReady = await startCamera(lastWorkingFacingModeRef.current);
      if (!cameraReady || cancelled) {
        return;
      }

      await initDetector();

      if (cancelled) {
        cancelRenderLoop();
        disposeDetector();
        setEngineState(isBrowserSupported() ? "idle" : "unsupported");
      }
    }

    void boot();

    return () => {
      cancelled = true;
      cancelRenderLoop();
      stopRecording();
      stopCurrentStream();
      disposeDetector();
      detectionInFlightRef.current = false;
      lastFacesRef.current = null;
      lastFaceSeenAtRef.current = 0;
      faceDetectedRef.current = false;
      setFaceDetected(false);
      setHasTorch(false);
      setCountdown(SNAP_MAX_DURATION_SECONDS);
    };
  }, [cancelRenderLoop, disposeDetector, enabled, initDetector, startCamera, stopCurrentStream, stopRecording]);

  useEffect(() => {
    if (!enabled || engineState !== "ready") {
      return;
    }

    if (!isWindowActive) {
      cancelRenderLoop();
      return;
    }

    if (!animationFrameRef.current) {
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    }
  }, [cancelRenderLoop, enabled, engineState, isWindowActive, renderLoop]);

  useEffect(() => {
    return () => {
      cancelRenderLoop();
      stopRecording();
      stopCurrentStream();
      disposeDetector();
      detectionInFlightRef.current = false;
      lastFacesRef.current = null;
      lastFaceSeenAtRef.current = 0;
      faceDetectedRef.current = false;
      setFaceDetected(false);
      setHasTorch(false);
      setCountdown(SNAP_MAX_DURATION_SECONDS);
    };
  }, [cancelRenderLoop, disposeDetector, stopCurrentStream, stopRecording]);

  const requestCamera = useCallback(async () => {
    const started = await startCamera(lastWorkingFacingModeRef.current, true);

    if (started && engineState === "failed") {
      await initDetector();
    }

    return started;
  }, [engineState, initDetector, startCamera]);

  const flipCamera = useCallback(async () => {
    if (flipInFlightRef.current) {
      return;
    }

    flipInFlightRef.current = true;
    setIsFlipping(true);
    const nextFacingMode = lastWorkingFacingModeRef.current === "user" ? "environment" : "user";
    const success = await startCamera(nextFacingMode, true);

    if (!success && nextFacingMode !== lastWorkingFacingModeRef.current) {
      await startCamera(lastWorkingFacingModeRef.current, true);
    }

    window.setTimeout(() => {
      setIsFlipping(false);
      flipInFlightRef.current = false;
    }, 320);
  }, [startCamera]);

  const switchFilter = useCallback(async (filterId: ArFilterId) => {
    setLoadingFilterId(filterId);
    activeFilterRef.current = filterId;
    setActiveFilter(filterId);
    await new Promise((resolve) => window.setTimeout(resolve, 90));
    setLoadingFilterId("");
  }, []);

  const capturePhoto = useCallback(async (): Promise<CaptureResult> => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Camera preview is not ready yet.");
    }

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
      fileName: `ghosting-${Date.now()}.jpg`
    };
  }, []);

  const startVideoRecording = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      throw new Error("Camera preview is not ready yet.");
    }

    const stream = canvas.captureStream(SNAP_VIDEO_FRAME_RATE);
    const mimeType = getRecordingMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
      videoBitsPerSecond: SNAP_VIDEO_BITS_PER_SECOND
    });

    recorderChunksRef.current = [];
    recorderRef.current = recorder;
    setIsRecording(true);
    setCountdown(SNAP_MAX_DURATION_SECONDS);
    const startedAt = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recorderChunksRef.current.push(event.data);
      }
    };

    recorder.start(250);

    const countdownInterval = window.setInterval(() => {
      const secondsLeft = Math.max(
        0,
        SNAP_MAX_DURATION_SECONDS - Math.floor((Date.now() - startedAt) / 1000)
      );
      setCountdown(secondsLeft);
    }, 200);

    recordingTimeoutRef.current = window.setTimeout(() => {
      stopRecording();
    }, SNAP_MAX_DURATION_MS);

    return await new Promise<CaptureResult>((resolve) => {
      recorder.onstop = () => {
        window.clearInterval(countdownInterval);
        setIsRecording(false);
        setCountdown(SNAP_MAX_DURATION_SECONDS);
        stream.getTracks().forEach((track) => track.stop());
        recorderRef.current = null;
        const outputMimeType = recorder.mimeType || mimeType || "video/webm";
        const blob = new Blob(recorderChunksRef.current, { type: outputMimeType });
        resolve({
          blob,
          previewUrl: URL.createObjectURL(blob),
          mimeType: outputMimeType,
          fileName: `ghosting-${Date.now()}.webm`
        });
      };
    });
  }, [stopRecording]);

  return {
    videoRef,
    canvasRef,
    streamRef,
    activeFilter,
    permission,
    engineState,
    error,
    isReady: engineState === "ready",
    loadingAR: engineState === "loading",
    isFlipping,
    isRecording,
    countdown,
    faceDetected,
    facingMode,
    flashMode,
    hasTorch,
    loadingFilterId,
    setError,
    switchFilter,
    capturePhoto,
    startVideoRecording,
    stopVideoRecording: stopRecording,
    requestCamera,
    flipCamera,
    cycleFlashMode: () => {
      if (!hasTorch) {
        return;
      }

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
  };
}
