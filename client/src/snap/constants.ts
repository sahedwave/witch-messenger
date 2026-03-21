export const SNAP_MAX_DURATION_SECONDS = 10;
export const SNAP_MAX_DURATION_MS = SNAP_MAX_DURATION_SECONDS * 1000;
export const SNAP_VIDEO_BITS_PER_SECOND = 650_000;
export const SNAP_VIDEO_FRAME_RATE = 20;
export const SNAP_CAMERA_WIDTH = 320;
export const SNAP_CAMERA_HEIGHT = 240;
export const SNAP_MAX_VIDEO_BYTES = 2 * 1024 * 1024;
export const SNAP_MAX_IMAGE_BYTES = 500 * 1024;
export const SNAP_DETECTION_INTERVAL_MS = 120;
export const SNAP_DEBUG_METRICS =
  import.meta.env.DEV && import.meta.env.VITE_SNAP_DEBUG === "true";
