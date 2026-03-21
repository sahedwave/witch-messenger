import { useEffect, useMemo, useState } from "react";
import { resolveApiAssetUrl } from "../api";

function formatFileSize(size = 0) {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatDisplayDateTime(value) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(new Date(value));
}

function buildPdfSource(file, page, zoom) {
  const source = resolveApiAssetUrl(file?.previewUrl || file?.dataUrl || "");

  if (!source) {
    return "";
  }

  return `${source}#page=${page}&zoom=${zoom}&toolbar=0&navpanes=0`;
}

function SessionHistoryCard({ session }) {
  const statusLabel =
    session.status === "completed"
      ? "Review completed"
      : session.status === "declined"
        ? "Review declined"
        : session.status === "pending"
          ? "Review requested"
          : "Review active";

  return (
    <article className="pdf-review-history-item">
      <strong>{session.file.name}</strong>
      <span>{statusLabel}</span>
      <small>{formatDisplayDateTime(session.endedAt || session.acceptedAt || session.createdAt)}</small>
    </article>
  );
}

export function PdfReviewFlyout({
  activeContact,
  currentUserId,
  sessions = [],
  onCreateSession = async () => {},
  onRespondSession = async () => {},
  onUpdateSession = async () => {}
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [busyAction, setBusyAction] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [localViewer, setLocalViewer] = useState({ page: 1, zoom: 100 });
  const [followPresenter, setFollowPresenter] = useState(true);

  const incomingPendingSession = useMemo(
    () => sessions.find((session) => session.status === "pending" && session.participant.id === currentUserId) || null,
    [currentUserId, sessions]
  );
  const outgoingPendingSession = useMemo(
    () => sessions.find((session) => session.status === "pending" && session.initiator.id === currentUserId) || null,
    [currentUserId, sessions]
  );
  const activeSession = useMemo(
    () => sessions.find((session) => session.status === "accepted") || null,
    [sessions]
  );
  const historySessions = useMemo(
    () => sessions.filter((session) => session.status === "completed" || session.status === "declined").slice(0, 4),
    [sessions]
  );

  const isPresenting = activeSession?.presenterId === currentUserId;
  const isFollowingPresenter =
    Boolean(activeSession?.syncEnabled) &&
    Boolean(activeSession?.presenterId) &&
    activeSession.presenterId !== currentUserId &&
    followPresenter;
  const effectiveViewer = isFollowingPresenter
    ? {
        page: activeSession.viewerState.page,
        zoom: activeSession.viewerState.zoom
      }
    : localViewer;

  useEffect(() => {
    setSelectedFile(null);
    setDraftTitle("");
    setDraftNote("");
  }, [activeContact?.id]);

  useEffect(() => {
    if (!activeSession) {
      setLocalViewer({ page: 1, zoom: 100 });
      setFollowPresenter(true);
      return;
    }

    setLocalViewer({
      page: activeSession.viewerState?.page || 1,
      zoom: activeSession.viewerState?.zoom || 100
    });
  }, [activeSession?.id]);

  useEffect(() => {
    if (!activeSession || (!followPresenter && !isPresenting)) {
      return;
    }

    setLocalViewer({
      page: activeSession.viewerState?.page || 1,
      zoom: activeSession.viewerState?.zoom || 100
    });
  }, [
    activeSession,
    activeSession?.viewerState?.page,
    activeSession?.viewerState?.zoom,
    followPresenter,
    isPresenting
  ]);

  async function handleCreateReview(event) {
    event.preventDefault();

    if (!selectedFile || !activeContact) {
      return;
    }

    try {
      setErrorMessage("");
      setBusyAction("create");
      await onCreateSession({
        file: selectedFile,
        title: draftTitle.trim(),
        note: draftNote.trim()
      });
      setSelectedFile(null);
      setDraftTitle("");
      setDraftNote("");
    } catch (error) {
      setErrorMessage(error.message || "Unable to start PDF review.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleRespond(sessionId, decision) {
    try {
      setErrorMessage("");
      setBusyAction(`${decision}-${sessionId}`);
      await onRespondSession(sessionId, decision);
    } catch (error) {
      setErrorMessage(error.message || "Unable to update the review request.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleSessionUpdate(sessionId, payload, busyKey) {
    try {
      setErrorMessage("");
      setBusyAction(busyKey);
      await onUpdateSession(sessionId, payload);
    } catch (error) {
      setErrorMessage(error.message || "Unable to update the review session.");
    } finally {
      setBusyAction("");
    }
  }

  async function handleViewerChange(partialState) {
    const nextViewer = {
      page: Math.max(1, partialState.page ?? effectiveViewer.page),
      zoom: Math.max(50, Math.min(200, partialState.zoom ?? effectiveViewer.zoom))
    };

    setLocalViewer(nextViewer);

    if (activeSession && isPresenting && activeSession.syncEnabled) {
      await onUpdateSession(activeSession.id, { viewerState: nextViewer }, { silent: true });
    }
  }

  if (!activeContact) {
    return (
      <section className="chat-action-card secondary rail-flyout pdf-review-flyout">
        <div className="pdf-review-empty">
          <strong>Shared PDF review</strong>
          <p>Open a conversation first, then invite that person into a live document review.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="chat-action-card secondary rail-flyout pdf-review-flyout">
      <div className="pdf-review-head">
        <div>
          <strong>Shared PDF review</strong>
          <p>Invite {activeContact.displayName || activeContact.name} into a temporary review room. The file leaves the surface when the session ends.</p>
        </div>
      </div>

      {errorMessage ? <p className="pdf-review-error">{errorMessage}</p> : null}

      {incomingPendingSession ? (
        <section className="pdf-review-card is-pending">
          <div className="pdf-review-card-copy">
            <strong>{incomingPendingSession.title || incomingPendingSession.file.name}</strong>
            <span>{incomingPendingSession.initiator.name} wants to review this PDF with you.</span>
            <small>
              {formatFileSize(incomingPendingSession.file.size)} · requested {formatDisplayDateTime(incomingPendingSession.createdAt)}
            </small>
          </div>
          <div className="pdf-review-card-actions">
            <button
              className="ghost-button subtle-button compact"
              type="button"
              disabled={busyAction === `accepted-${incomingPendingSession.id}`}
              onClick={() => handleRespond(incomingPendingSession.id, "accepted")}
            >
              Accept
            </button>
            <button
              className="ghost-button subtle-button compact"
              type="button"
              disabled={busyAction === `declined-${incomingPendingSession.id}`}
              onClick={() => handleRespond(incomingPendingSession.id, "declined")}
            >
              Decline
            </button>
          </div>
        </section>
      ) : null}

      {outgoingPendingSession ? (
        <section className="pdf-review-card is-waiting">
          <div className="pdf-review-card-copy">
            <strong>{outgoingPendingSession.title || outgoingPendingSession.file.name}</strong>
            <span>Waiting for {activeContact.displayName || activeContact.name} to accept the review request.</span>
            <small>{formatDisplayDateTime(outgoingPendingSession.createdAt)}</small>
          </div>
        </section>
      ) : null}

      {activeSession ? (
        <section className="pdf-review-live-shell">
          <div className="pdf-review-live-head">
            <div>
              <strong>{activeSession.title || activeSession.file.name}</strong>
              <span>
                {isPresenting
                  ? "You are presenting this PDF"
                  : activeSession.presenterId
                    ? `Following ${activeSession.presenterId === activeSession.initiator.id ? activeSession.initiator.name : activeSession.participant.name}`
                    : "No presenter is active"}
              </span>
            </div>
            <div className="pdf-review-control-row">
              <button
                className="ghost-button subtle-button compact"
                type="button"
                disabled={busyAction === `present-${activeSession.id}`}
                onClick={() =>
                  handleSessionUpdate(
                    activeSession.id,
                    { presenterId: isPresenting ? null : currentUserId },
                    `present-${activeSession.id}`
                  )
                }
              >
                {isPresenting ? "Stop presenting" : "Take control"}
              </button>
              <button
                className={`ghost-button subtle-button compact ${followPresenter ? "is-active" : ""}`}
                type="button"
                onClick={() => setFollowPresenter((current) => !current)}
              >
                {followPresenter ? "Following live" : "Independent view"}
              </button>
              <button
                className={`ghost-button subtle-button compact ${activeSession.syncEnabled ? "is-active" : ""}`}
                type="button"
                disabled={busyAction === `sync-${activeSession.id}`}
                onClick={() =>
                  handleSessionUpdate(
                    activeSession.id,
                    { syncEnabled: !activeSession.syncEnabled },
                    `sync-${activeSession.id}`
                  )
                }
              >
                {activeSession.syncEnabled ? "Shared nav on" : "Shared nav off"}
              </button>
              <button
                className="ghost-button subtle-button compact"
                type="button"
                disabled={busyAction === `complete-${activeSession.id}`}
                onClick={() =>
                  handleSessionUpdate(activeSession.id, { status: "completed" }, `complete-${activeSession.id}`)
                }
              >
                End review
              </button>
            </div>
          </div>

          <div className="pdf-review-toolbar">
            <button
              className="ghost-button subtle-button compact"
              type="button"
              disabled={effectiveViewer.page <= 1 || isFollowingPresenter}
              onClick={() => handleViewerChange({ page: effectiveViewer.page - 1 })}
            >
              Prev
            </button>
            <label className="pdf-review-inline-field">
              <span>Page</span>
              <input
                type="number"
                min="1"
                value={effectiveViewer.page}
                disabled={isFollowingPresenter}
                onChange={(event) => handleViewerChange({ page: Number.parseInt(event.target.value || "1", 10) })}
              />
            </label>
            <button
              className="ghost-button subtle-button compact"
              type="button"
              disabled={isFollowingPresenter}
              onClick={() => handleViewerChange({ page: effectiveViewer.page + 1 })}
            >
              Next
            </button>
            <label className="pdf-review-inline-field">
              <span>Zoom</span>
              <select
                value={effectiveViewer.zoom}
                disabled={isFollowingPresenter}
                onChange={(event) => handleViewerChange({ zoom: Number.parseInt(event.target.value, 10) })}
              >
                {[75, 100, 125, 150, 175].map((zoom) => (
                  <option key={zoom} value={zoom}>
                    {zoom}%
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeSession.file.previewUrl || activeSession.file.dataUrl ? (
            <div className="pdf-review-viewer-shell">
              <iframe
                key={`${activeSession.id}-${effectiveViewer.page}-${effectiveViewer.zoom}`}
                className="pdf-review-viewer"
                src={buildPdfSource(activeSession.file, effectiveViewer.page, effectiveViewer.zoom)}
                title={activeSession.file.name}
              />
            </div>
          ) : (
            <div className="pdf-review-empty">
              <strong>Review file removed</strong>
              <p>The shared PDF was cleared after the session ended. Only the history record remains.</p>
            </div>
          )}
        </section>
      ) : null}

      {!incomingPendingSession && !outgoingPendingSession && !activeSession ? (
        <form className="pdf-review-form" onSubmit={handleCreateReview}>
          <div className="pdf-review-section-head">
            <strong>Start a review</strong>
            <span>The actual PDF stays out of chat and is cleared when the review ends.</span>
          </div>
          <label className="pdf-review-file-picker">
            <span>{selectedFile ? selectedFile.name : "Choose PDF"}</span>
            <input
              type="file"
              accept="application/pdf"
              onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            />
          </label>
          <label>
            <span>Session title</span>
            <input
              type="text"
              placeholder="Quarterly proposal review"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
            />
          </label>
          <label>
            <span>Note</span>
            <textarea
              rows={3}
              placeholder="What should both sides focus on?"
              value={draftNote}
              onChange={(event) => setDraftNote(event.target.value)}
            />
          </label>
          <div className="pdf-review-submit-row">
            <button className="ghost-button compact-header-toggle calendar-save-button" type="submit" disabled={!selectedFile || busyAction === "create"}>
              Send review request
            </button>
            <small>Max 100 MB PDF. The thread keeps only the review history.</small>
          </div>
        </form>
      ) : null}

      {historySessions.length ? (
        <section className="pdf-review-history">
          <div className="pdf-review-section-head">
            <strong>Review history</strong>
            <span>Compact records stay in the conversation after the file is cleared.</span>
          </div>
          <div className="pdf-review-history-list">
            {historySessions.map((session) => (
              <SessionHistoryCard key={session.id} session={session} />
            ))}
          </div>
        </section>
      ) : null}
    </section>
  );
}
