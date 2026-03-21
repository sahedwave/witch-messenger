import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import snapWindowMockup from "../assets/snap-window-mockup.svg";
import { SNAP_MAX_DURATION_MS, SNAP_MAX_DURATION_SECONDS } from "../snap/constants";
import { SNAP_FILTERS } from "../snap/filterCatalog";
import { useTensorFaceAr } from "../snap/hooks/useTensorFaceAr";
import { useUpload } from "../snap/hooks/useUpload";

const durationOptions = [1, 3, 5, 10];

function revokeDraft(draft) {
  if (draft?.previewUrl && String(draft.previewUrl).startsWith("blob:")) {
    URL.revokeObjectURL(draft.previewUrl);
  }
}

export default function SnapWindowMockup({
  isOpen,
  onClose,
  onSendSnap,
  recipientName
}) {
  const previousDraftRef = useRef(null);
  const filterStripRef = useRef(null);
  const filterItemRefs = useRef([]);
  const captureButtonRef = useRef(null);
  const captureHoldTimeoutRef = useRef(null);
  const capturePressRef = useRef({
    active: false,
    pointerId: null,
    startedVideo: false
  });
  const pendingVideoResultRef = useRef(null);
  const filterDragRef = useRef({
    active: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    moved: false
  });
  const [draft, setDraft] = useState(null);
  const [duration, setDuration] = useState(5);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [isCapturePressed, setIsCapturePressed] = useState(false);

  const ar = useTensorFaceAr({
    enabled: isOpen && !draft && !sending
  });
  const upload = useUpload();
  const activeFilter = useMemo(
    () => SNAP_FILTERS.find((filter) => filter.id === ar.activeFilter) || SNAP_FILTERS[0],
    [ar.activeFilter]
  );
  const isRecording = ar.isRecording;
  const visibleShellError =
    error || upload.error || ar.error || "";

  function handleClose() {
    if (pendingVideoResultRef.current) {
      ar.stopVideoRecording();
      pendingVideoResultRef.current = null;
    }

    revokeDraft(previousDraftRef.current);
    previousDraftRef.current = null;
    setDraft(null);
    setSending(false);
    setError("");
    onClose();
  }

  useEffect(() => {
    if (!isOpen) {
      revokeDraft(previousDraftRef.current);
      previousDraftRef.current = null;
      setDraft(null);
      setSending(false);
      setError("");
      setIsCapturePressed(false);
      return;
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        handleClose();
      }
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (previousDraftRef.current && previousDraftRef.current !== draft) {
      revokeDraft(previousDraftRef.current);
    }

    previousDraftRef.current = draft;
  }, [draft]);

  useEffect(() => () => revokeDraft(previousDraftRef.current), []);

  useEffect(() => {
    filterItemRefs.current = filterItemRefs.current.slice(0, SNAP_FILTERS.length);
  }, []);

  function centerFilter(index, behavior = "smooth") {
    const strip = filterStripRef.current;
    const item = filterItemRefs.current[index];

    if (!strip || !item) {
      return;
    }

    item.scrollIntoView({
      behavior,
      block: "nearest",
      inline: "center"
    });

    const targetLeft = item.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2;
    window.requestAnimationFrame(() => {
      strip.scrollTo({
        left: Math.max(0, targetLeft),
        behavior
      });
    });
  }

  useEffect(() => {
    if (!isOpen || draft) {
      return;
    }

    const activeIndex = SNAP_FILTERS.findIndex((filter) => filter.id === ar.activeFilter);
    const timerId = window.setTimeout(() => {
      centerFilter(Math.max(0, activeIndex), "auto");
    }, 30);

    return () => window.clearTimeout(timerId);
  }, [ar.activeFilter, draft, isOpen]);

  function handleFilterScroll() {
    const strip = filterStripRef.current;
    if (!strip) {
      return;
    }

    const center = strip.scrollLeft + strip.clientWidth / 2;
    let nearestIndex = SNAP_FILTERS.findIndex((filter) => filter.id === ar.activeFilter);
    let nearestDistance = Number.POSITIVE_INFINITY;

    filterItemRefs.current.forEach((item, index) => {
      if (!item) {
        return;
      }

      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const distance = Math.abs(itemCenter - center);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    if (nearestIndex >= 0 && SNAP_FILTERS[nearestIndex]?.id !== ar.activeFilter) {
      void ar.switchFilter(SNAP_FILTERS[nearestIndex].id);
    }
  }

  function settleFilterToCenter() {
    const strip = filterStripRef.current;
    if (!strip) {
      return;
    }

    const center = strip.scrollLeft + strip.clientWidth / 2;
    let nearestIndex = SNAP_FILTERS.findIndex((filter) => filter.id === ar.activeFilter);
    let nearestDistance = Number.POSITIVE_INFINITY;

    filterItemRefs.current.forEach((item, index) => {
      if (!item) {
        return;
      }

      const itemCenter = item.offsetLeft + item.offsetWidth / 2;
      const distance = Math.abs(itemCenter - center);

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });

    if (nearestIndex >= 0) {
      void ar.switchFilter(SNAP_FILTERS[nearestIndex].id);
      centerFilter(nearestIndex);
    }
  }

  function handleFilterPointerDown(event) {
    const strip = filterStripRef.current;
    if (!strip) {
      return;
    }

    filterDragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: strip.scrollLeft,
      moved: false
    };

    strip.setPointerCapture?.(event.pointerId);
  }

  function handleFilterPointerMove(event) {
    const strip = filterStripRef.current;
    const drag = filterDragRef.current;

    if (!strip || !drag.active) {
      return;
    }

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      drag.moved = true;
    }

    strip.scrollLeft = drag.startScrollLeft - deltaX;
  }

  function handleFilterPointerEnd(event) {
    const strip = filterStripRef.current;
    const drag = filterDragRef.current;

    if (!strip || !drag.active) {
      return;
    }

    strip.releasePointerCapture?.(event.pointerId);
    filterDragRef.current = {
      active: false,
      pointerId: null,
      startX: 0,
      startScrollLeft: 0,
      moved: drag.moved
    };

    if (drag.moved) {
      window.requestAnimationFrame(() => {
        settleFilterToCenter();
      });
    }
  }

  async function handleCapturePhoto() {
    try {
      const result = await ar.capturePhoto();
      setDraft({
        kind: "photo",
        blob: result.blob,
        previewUrl: result.previewUrl,
        mimeType: result.mimeType,
        fileName: result.fileName,
        durationMs: duration * 1000,
        filterAppliedInMedia: true
      });
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to capture photo.");
    }
  }

  async function startVideoRecording() {
    try {
      pendingVideoResultRef.current = ar.startVideoRecording();
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to start video recording.");
    }
  }

  async function stopVideoRecording() {
    if (!pendingVideoResultRef.current) {
      return;
    }

    try {
      ar.stopVideoRecording();
      const result = await pendingVideoResultRef.current;
      pendingVideoResultRef.current = null;
      setDraft({
        kind: "video",
        blob: result.blob,
        previewUrl: result.previewUrl,
        mimeType: result.mimeType,
        fileName: result.fileName,
        durationMs: SNAP_MAX_DURATION_MS,
        filterAppliedInMedia: true
      });
      setError("");
    } catch (nextError) {
      pendingVideoResultRef.current = null;
      setError(nextError instanceof Error ? nextError.message : "Unable to finish video recording.");
    }
  }

  function resetCapturePressState() {
    if (captureHoldTimeoutRef.current) {
      window.clearTimeout(captureHoldTimeoutRef.current);
      captureHoldTimeoutRef.current = null;
    }

    capturePressRef.current = {
      active: false,
      pointerId: null,
      startedVideo: false
    };
    setIsCapturePressed(false);
  }

  function handleCapturePointerDown(event) {
    if (draft || sending) {
      return;
    }

    setError("");
    setIsCapturePressed(true);
    capturePressRef.current = {
      active: true,
      pointerId: event.pointerId,
      startedVideo: false
    };
    captureButtonRef.current?.setPointerCapture?.(event.pointerId);

    captureHoldTimeoutRef.current = window.setTimeout(() => {
      if (!capturePressRef.current.active || draft || sending) {
        return;
      }

      capturePressRef.current.startedVideo = true;
      void startVideoRecording();
    }, 220);
  }

  function handleCapturePointerEnd(event) {
    const press = capturePressRef.current;
    if (!press.active) {
      return;
    }

    captureButtonRef.current?.releasePointerCapture?.(event.pointerId);

    if (press.startedVideo) {
      void stopVideoRecording();
      resetCapturePressState();
      return;
    }

    resetCapturePressState();
    void handleCapturePhoto();
  }

  function handleCapturePointerCancel(event) {
    captureButtonRef.current?.releasePointerCapture?.(event.pointerId);
    void stopVideoRecording();
    resetCapturePressState();
  }

  async function handleSend() {
    if (!draft || sending) {
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

      const sent = await onSendSnap({
        type: "snap",
        mediaUrl: result.mediaUrl,
        thumbnail: result.thumbnailUrl,
        duration: result.duration,
        expiresAt: new Date(Date.now() + result.duration * 1000).toISOString(),
        mimeType: result.mimeType,
        fileName: result.fileName,
        size: result.size,
        caption: recipientName ? `To ${recipientName}` : ""
      });

      if (sent === false) {
        setSending(false);
        setError("Unable to send snap in this conversation.");
        return;
      }

      handleClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Unable to send snap.");
      setSending(false);
    }
  }

  function handleRetake() {
    revokeDraft(draft);
    setDraft(null);
    setError("");
  }

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="snap-window-overlay" role="dialog" aria-modal="true" onClick={handleClose}>
      <div className="snap-window-card snap-window-shell" onClick={(event) => event.stopPropagation()}>
        <img alt="Snap camera shell" className="snap-window-image" src={snapWindowMockup} />

        <div className="snap-shell-preview">
          {draft ? (
            draft.kind === "photo" ? (
              <img
                alt="Snap preview"
                src={draft.previewUrl}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <video
                autoPlay
                loop
                muted
                playsInline
                src={draft.previewUrl}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            )
          ) : (
            <>
              <video ref={ar.videoRef} className="snap-shell-source-video" muted playsInline />
              <canvas
                ref={ar.canvasRef}
                className={`snap-shell-ar-canvas ${ar.isFlipping ? "is-flipping" : ""}`}
              />
              {ar.isReady ? (
                <div className="snap-shell-live-ar-badge">
                  <span className="snap-shell-live-ar-dot" aria-hidden="true" />
                  LIVE AR
                </div>
              ) : null}
              {ar.isReady && ar.permission === "granted" ? (
                <div className="snap-shell-face-status">
                  {ar.faceDetected ? "Face detected" : "Center your face in frame"}
                </div>
              ) : null}
              {ar.loadingAR ? (
                <div className="snap-shell-preview-state">
                  <span className="snap-shell-ar-spinner" aria-hidden="true" />
                  <strong>Loading AR Engine...</strong>
                  <span>Powered by TensorFlow.js</span>
                </div>
              ) : null}
              {ar.permission === "denied" ? (
                <div className="snap-shell-preview-state">
                  <strong>Camera access needed</strong>
                  <span>{ar.error || "Allow camera to send a snap."}</span>
                  <button
                    className="snap-shell-pill"
                    type="button"
                    onClick={() => {
                      setError("");
                      void ar.requestCamera();
                    }}
                  >
                    Allow Camera
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        <button className="snap-shell-close-hit" type="button" onClick={handleClose} />

        <button
          className="snap-shell-flash-hit"
          type="button"
          onClick={ar.cycleFlashMode}
          title={ar.hasTorch ? "Cycle flash mode" : "Torch unavailable on this camera"}
          disabled={!ar.hasTorch}
        >
          {!ar.hasTorch
            ? "⚡ N/A"
            : ar.flashMode === "off"
              ? "⚡ Off"
              : ar.flashMode === "on"
                ? "⚡ On"
                : "⚡ Auto"}
        </button>

        <button
          className={`snap-shell-flip-hit ${ar.isFlipping ? "is-flipping" : ""}`}
          type="button"
          disabled={ar.engineState === "loading"}
          onClick={() => {
            setError("");
            void ar.flipCamera();
          }}
          title="Flip camera"
        >
          ↻
        </button>

        {!draft ? (
          <>
            <div className="snap-shell-filter-mask" aria-hidden="true" />
            <div className="snap-shell-filter-frame">
              <div className="snap-shell-filter-fade snap-shell-filter-fade-left" />
              <div
                className="snap-shell-filter-strip"
                ref={filterStripRef}
                onScroll={handleFilterScroll}
                onPointerDown={handleFilterPointerDown}
                onPointerMove={handleFilterPointerMove}
                onPointerUp={handleFilterPointerEnd}
                onPointerCancel={handleFilterPointerEnd}
                onPointerLeave={handleFilterPointerEnd}
              >
                {SNAP_FILTERS.map((filter, index) => (
                  <button
                    key={filter.id}
                    className={`snap-shell-filter-chip ${filter.id === ar.activeFilter ? "is-active" : ""}`}
                    ref={(node) => {
                      filterItemRefs.current[index] = node;
                    }}
                    type="button"
                    onClick={() => {
                      if (filterDragRef.current.moved) {
                        filterDragRef.current.moved = false;
                        return;
                      }

                      setError("");
                      void ar.switchFilter(filter.id);
                      window.requestAnimationFrame(() => {
                        centerFilter(index);
                      });
                    }}
                  >
                    <span className="snap-shell-filter-emoji" aria-hidden="true">
                      {filter.emoji}
                      {ar.loadingFilterId === filter.id ? (
                        <span className="snap-shell-filter-spinner" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className="snap-shell-filter-label">{filter.label}</span>
                  </button>
                ))}
              </div>
              <div className="snap-shell-filter-fade snap-shell-filter-fade-right" />
            </div>
          </>
        ) : null}

        {draft?.kind === "photo" ? (
          <div className="snap-shell-duration-hits">
            {durationOptions.map((value) => (
              <button
                key={value}
                className={`snap-shell-duration-hit ${duration === value ? "is-active" : ""}`}
                type="button"
                onClick={() => setDuration(value)}
              >
                {value}s
              </button>
            ))}
          </div>
        ) : null}

        {draft ? (
          <button className="snap-shell-retake-hit" type="button" onClick={handleRetake}>
            Retake
          </button>
        ) : null}

        <button
          className={`snap-shell-capture-hit ${isCapturePressed ? "is-pressed" : ""}`}
          ref={captureButtonRef}
          type="button"
          onPointerDown={handleCapturePointerDown}
          onPointerUp={handleCapturePointerEnd}
          onPointerCancel={handleCapturePointerCancel}
          onPointerLeave={handleCapturePointerCancel}
        />

        <button
          className={`snap-shell-send-hit ${draft ? "is-ready" : ""}`}
          type="button"
          disabled={!draft || sending}
          onClick={handleSend}
          aria-label={sending ? "Sending snap" : "Send snap"}
        >
          <svg
            className={`snap-shell-send-icon ${sending ? "is-sending" : ""}`}
            viewBox="0 0 64 64"
            aria-hidden="true"
          >
            <path
              d="M6 31.5 57 8 37.5 56 28 35.5 6 31.5Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d="M28 35.5 57 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d="M6 31.5 28 35.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {isRecording ? (
          <div className="snap-shell-recording-tag">REC {ar.countdown}s</div>
        ) : null}

        {visibleShellError ? <div className="snap-shell-error-banner">{visibleShellError}</div> : null}
      </div>
    </div>,
    document.body
  );
}
