import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "./Avatar";
import { buildMemoryCapsuleDraft, formatClockTime, formatDisplayDate } from "../memory-capsule-utils";

const TONE_OPTIONS = [
  { value: "warm", label: "Warm" },
  { value: "playful", label: "Playful" },
  { value: "future", label: "Future us" },
  { value: "promise", label: "Promise" }
];

const OPEN_MODE_OPTIONS = [
  { value: "solo", label: "Open solo" },
  { value: "together", label: "Open together" }
];

const PRIVACY_MODE_OPTIONS = [
  { value: "shared", label: "Shared capsule" },
  { value: "gift", label: "One-sided gift" },
  { value: "mutual", label: "Mutual memory" }
];

const RETENTION_MODE_OPTIONS = [
  { value: "archive", label: "Keep in archive" },
  { value: "auto-delete", label: "Auto-delete after opening" }
];

const CAPSULE_REACTIONS = ["❤️", "✨", "🥹", "🤍", "🫶"];

function statusLabel(state) {
  switch (state) {
    case "opened":
      return "Opened";
    case "ready":
      return "Ready to open";
    default:
      return "Sealed";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function renderCapsuleAttachment(attachment) {
  if (!attachment) {
    return null;
  }

  if (attachment.mimeType?.startsWith("image/")) {
    return <img className="memory-capsule-attachment-image" src={attachment.dataUrl} alt={attachment.name} />;
  }

  if (attachment.mimeType?.startsWith("audio/")) {
    return <audio controls src={attachment.dataUrl} />;
  }

  if (attachment.mimeType?.startsWith("video/")) {
    return <video controls src={attachment.dataUrl} />;
  }

  return (
    <a className="message-attachment-card" href={attachment.dataUrl} download={attachment.name}>
      <strong>{attachment.name}</strong>
      <span>{attachment.mimeType || "Attachment"}</span>
    </a>
  );
}

export function MemoryCapsuleFlyout({
  activeContact,
  capsules = [],
  currentUserId,
  onDeleteCapsule = () => {},
  onOpenCapsule = () => {},
  onReactCapsule = () => {},
  onReplyCapsule = () => {},
  onSaveCapsule = () => {}
}) {
  const [draft, setDraft] = useState(() => buildMemoryCapsuleDraft(activeContact));
  const [editingId, setEditingId] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [replyDrafts, setReplyDrafts] = useState({});
  const formRef = useRef(null);

  useEffect(() => {
    setDraft(buildMemoryCapsuleDraft(activeContact));
    setEditingId(null);
    setShowHistory(false);
    setReplyDrafts({});
  }, [activeContact?.id]);

  const conversationCapsules = useMemo(() => capsules, [capsules]);

  const stats = useMemo(() => {
    return conversationCapsules.reduce(
      (summary, capsule) => {
        summary.total += 1;
        summary[capsule.state] = (summary[capsule.state] || 0) + 1;
        return summary;
      },
      { total: 0, sealed: 0, ready: 0, opened: 0 }
    );
  }, [conversationCapsules]);

  function updateDraft(field, value) {
    setDraft((current) => ({
      ...current,
      [field]: value
    }));
  }

  async function handleAttachmentChange(file) {
    if (!file) {
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      throw new Error("Capsule attachments must be 8 MB or smaller.");
    }

    const dataUrl = await readFileAsDataUrl(file);
    setDraft((current) => ({
      ...current,
      attachment: {
        dataUrl,
        mimeType: file.type || "application/octet-stream",
        name: file.name,
        size: file.size
      }
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await onSaveCapsule(draft);
    setDraft(buildMemoryCapsuleDraft(activeContact));
    setEditingId(null);
  }

  function handleEditCapsule(capsule) {
    setEditingId(capsule.id);
    setDraft({
      ...capsule,
      unlockDate: capsule.unlockDate,
      unlockTime: capsule.unlockTime,
      attachment: capsule.attachment || null
    });
    setShowHistory(false);
    window.requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleCancelEdit() {
    setDraft(buildMemoryCapsuleDraft(activeContact));
    setEditingId(null);
  }

  if (!activeContact) {
    return (
      <section className="chat-action-card secondary rail-flyout memory-capsule-flyout">
        <div className="pdf-review-empty">
          <strong>Memory capsule</strong>
          <p>Open a conversation first, then seal a future moment for that person.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="chat-action-card secondary rail-flyout memory-capsule-flyout">
      <div className="memory-capsule-head">
        <div>
          <strong>Memory capsule</strong>
          <p>Shared, delayed memories with media, opening rituals, replies, and reactions.</p>
        </div>
      </div>

      <section className="memory-capsule-summary-grid">
        <div>
          <strong>{stats.total}</strong>
          <span>Total</span>
        </div>
        <div>
          <strong>{stats.sealed}</strong>
          <span>Sealed</span>
        </div>
        <div>
          <strong>{stats.ready}</strong>
          <span>Ready</span>
        </div>
        <div>
          <strong>{stats.opened}</strong>
          <span>Opened</span>
        </div>
      </section>

      <div className="memory-capsule-toolbar">
        <button
          className={`ghost-button subtle-button compact ${showHistory ? "is-active" : ""}`}
          type="button"
          onClick={() => setShowHistory((current) => !current)}
        >
          History
        </button>
        <span>{conversationCapsules.length ? `${conversationCapsules.length} shared capsules` : "No capsules yet"}</span>
      </div>

      {showHistory ? (
        conversationCapsules.length ? (
          <section className="memory-capsule-list">
            {conversationCapsules.slice(0, 8).map((capsule) => {
              const isTogetherPending =
                capsule.openMode === "together" &&
                capsule.state === "ready" &&
                capsule.openRequestBy &&
                !capsule.openedAt;
              const requestedByCurrentUser = capsule.openRequestBy === currentUserId;
              const canOpen = capsule.state === "ready";
              const canReact = capsule.state === "opened";
              const canReply = capsule.state === "opened";

              return (
                <article key={capsule.id} className={`memory-capsule-card is-${capsule.state}`}>
                  <button
                    className="invoice-delete-button"
                    type="button"
                    aria-label={`Delete ${capsule.title || "capsule"}`}
                    title="Delete capsule"
                    onClick={() => onDeleteCapsule(capsule.id)}
                  >
                    ×
                  </button>
                  <div className="memory-capsule-copy">
                    <strong>{capsule.title || "Untitled capsule"}</strong>
                    <span>
                      {statusLabel(capsule.state)} · {TONE_OPTIONS.find((entry) => entry.value === capsule.tone)?.label || "Warm"} · {OPEN_MODE_OPTIONS.find((entry) => entry.value === capsule.openMode)?.label}
                    </span>
                    <small>
                      Opens {formatDisplayDate(capsule.unlockDate)} at {formatClockTime(capsule.unlockTime)} · {PRIVACY_MODE_OPTIONS.find((entry) => entry.value === capsule.privacyMode)?.label}
                    </small>
                    {capsule.isReminderWindow && capsule.state !== "opened" ? (
                      <div className="memory-capsule-hint">Opening soon reminder is active.</div>
                    ) : null}
                    {capsule.linkUrl ? (
                      <a className="link-preview expanded" href={capsule.linkUrl} target="_blank" rel="noreferrer">
                        <strong>Saved link</strong>
                        <span>{capsule.linkUrl}</span>
                      </a>
                    ) : null}
                    {capsule.state === "opened" ? <p>{capsule.notePreview || capsule.note}</p> : <p>Contents stay sealed until the opening time.</p>}
                    {capsule.state === "opened" && capsule.attachment ? (
                      <div className="memory-capsule-attachment-shell">{renderCapsuleAttachment(capsule.attachment)}</div>
                    ) : null}
                    {isTogetherPending ? (
                      <div className="memory-capsule-hint">
                        {requestedByCurrentUser
                          ? "Waiting for the other person to join the opening."
                          : `${activeContact.displayName || activeContact.name} wants to open this capsule together.`}
                      </div>
                    ) : null}
                  </div>
                  <div className="memory-capsule-actions">
                    {canOpen ? (
                      <button className="ghost-button subtle-button compact" type="button" onClick={() => onOpenCapsule(capsule.id)}>
                        {capsule.openMode === "together" ? (requestedByCurrentUser ? "Cancel request" : isTogetherPending ? "Open now" : "Open together") : "Open"}
                      </button>
                    ) : null}
                    {capsule.state !== "opened" ? (
                      <button className="ghost-button subtle-button compact" type="button" onClick={() => handleEditCapsule(capsule)}>
                        Edit
                      </button>
                    ) : null}
                  </div>

                  {canReact ? (
                    <div className="memory-capsule-reactions">
                      {CAPSULE_REACTIONS.map((emoji) => {
                        const reaction = capsule.reactions.find((entry) => entry.emoji === emoji);
                        const isActive = reaction?.users.includes(currentUserId);
                        return (
                          <button
                            key={emoji}
                            className={`reaction-button compact ${isActive ? "is-active" : ""}`}
                            type="button"
                            onClick={() => onReactCapsule(capsule.id, emoji)}
                          >
                            {emoji} {reaction?.count || ""}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {canReply ? (
                    <div className="memory-capsule-reply-board">
                      {capsule.replies.length ? (
                        <div className="memory-capsule-reply-list">
                          {capsule.replies.map((reply) => (
                            <div key={reply.id} className="memory-capsule-reply-item">
                              <span className="avatar-shell small">
                                <Avatar user={reply.author} size="small" />
                              </span>
                              <div>
                                <strong>{reply.author.name}</strong>
                                <p>{reply.text}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="memory-capsule-reply-form">
                        <input
                          type="text"
                          placeholder="Add a reply after opening"
                          value={replyDrafts[capsule.id] || ""}
                          onChange={(event) =>
                            setReplyDrafts((current) => ({
                              ...current,
                              [capsule.id]: event.target.value
                            }))
                          }
                        />
                        <button
                          className="ghost-button subtle-button compact"
                          type="button"
                          onClick={() => {
                            const value = (replyDrafts[capsule.id] || "").trim();
                            if (!value) {
                              return;
                            }

                            void onReplyCapsule(capsule.id, value);
                            setReplyDrafts((current) => ({
                              ...current,
                              [capsule.id]: ""
                            }));
                          }}
                        >
                          Reply
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : (
          <div className="pdf-review-empty">
            <strong>No capsules yet</strong>
            <p>Create the first sealed memory for {activeContact.displayName || activeContact.name}.</p>
          </div>
        )
      ) : null}

      <form ref={formRef} className="memory-capsule-form" onSubmit={handleSubmit}>
        <div className="memory-capsule-form-head">
          <strong>{editingId ? "Edit capsule" : "New capsule"}</strong>
          <span>Build a capsule with media, opening rules, and privacy behavior.</span>
        </div>

        <div className="memory-capsule-form-row">
          <label>
            <span>Title</span>
            <input
              type="text"
              placeholder="First trip memory"
              value={draft.title}
              onChange={(event) => updateDraft("title", event.target.value)}
            />
          </label>
          <label>
            <span>Tone</span>
            <select value={draft.tone} onChange={(event) => updateDraft("tone", event.target.value)}>
              {TONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="memory-capsule-form-row">
          <label>
            <span>Open date</span>
            <input
              type="date"
              value={draft.unlockDate}
              onChange={(event) => updateDraft("unlockDate", event.target.value)}
            />
          </label>
          <label>
            <span>Open time</span>
            <input
              type="time"
              value={draft.unlockTime}
              onChange={(event) => updateDraft("unlockTime", event.target.value)}
            />
          </label>
        </div>

        <div className="memory-capsule-form-row">
          <label>
            <span>Opening ritual</span>
            <select value={draft.openMode} onChange={(event) => updateDraft("openMode", event.target.value)}>
              {OPEN_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Privacy</span>
            <select value={draft.privacyMode} onChange={(event) => updateDraft("privacyMode", event.target.value)}>
              {PRIVACY_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="memory-capsule-form-row">
          <label>
            <span>Retention</span>
            <select value={draft.retentionMode} onChange={(event) => updateDraft("retentionMode", event.target.value)}>
              {RETENTION_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Optional link</span>
            <input
              type="url"
              placeholder="https://..."
              value={draft.linkUrl || ""}
              onChange={(event) => updateDraft("linkUrl", event.target.value)}
            />
          </label>
        </div>

        <label>
          <span>Message inside the capsule</span>
          <textarea
            rows={5}
            placeholder="Write something worth opening later."
            value={draft.note}
            onChange={(event) => updateDraft("note", event.target.value)}
          />
        </label>

        <label>
          <span>Optional media</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,application/pdf,text/plain,audio/mpeg,audio/mp3,audio/wav,video/mp4"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }

              handleAttachmentChange(file).catch((error) => {
                console.error(error);
              });
              event.target.value = "";
            }}
          />
        </label>

        {draft.attachment ? (
          <div className="memory-capsule-attachment-shell">
            {renderCapsuleAttachment(draft.attachment)}
            <button className="ghost-button subtle-button compact" type="button" onClick={() => updateDraft("attachment", null)}>
              Remove attachment
            </button>
          </div>
        ) : null}

        <div className="memory-capsule-hint">
          This capsule will stay sealed until {formatDisplayDate(draft.unlockDate)} at {formatClockTime(draft.unlockTime)}.
        </div>

        <div className="memory-capsule-submit-row">
          {editingId ? (
            <button className="ghost-button subtle-button compact" type="button" onClick={handleCancelEdit}>
              Cancel
            </button>
          ) : null}
          <button className="ghost-button" type="submit" disabled={!draft.note.trim() && !draft.attachment && !draft.linkUrl}>
            {editingId ? "Save changes" : "Seal capsule"}
          </button>
        </div>
      </form>
    </section>
  );
}
