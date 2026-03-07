import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "./Avatar";

const reactionPalette = ["👍", "❤️", "😂", "🔥"];
const emojiPalette = ["😀", "😂", "😍", "👍", "🔥", "🎉", "🙏", "😎"];

function formatTimestamp(value) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatPresence(contact, isTyping) {
  if (isTyping) {
    return "Typing...";
  }

  if (contact.presenceStatus === "online") {
    return contact.deviceCount > 1 ? `Online on ${contact.deviceCount} devices` : "Online now";
  }

  if (contact.presenceStatus === "away") {
    return "Away";
  }

  if (contact.lastActiveAt) {
    return `Last active ${new Intl.RelativeTimeFormat([], { numeric: "auto" }).format(
      Math.round((new Date(contact.lastActiveAt).getTime() - Date.now()) / 60000),
      "minute"
    )}`;
  }

  return "Offline";
}

export function ConversationPane({
  activeContact,
  attachment,
  currentUserId,
  draft,
  editingMessageId,
  editingText,
  error,
  failedSend,
  forwardMessage,
  hasMoreMessages,
  isTyping,
  loading,
  loadingOlderMessages,
  messageSearch,
  messages,
  onAppendEmoji,
  onArchive,
  onAttachmentSelect,
  onAcceptRequest,
  onBack,
  onCancelEdit,
  onDeleteMessage,
  onDraftChange,
  onEditMessage,
  onEditingTextChange,
  onExportConversation,
  onForwardMessage,
  onLoadOlder,
  onReplyToMessage,
  onRemoveAttachment,
  onRestoreFromTrash,
  onRestrict,
  onRetryFailedSend,
  onSend,
  onSetLabels,
  onSetNickname,
  onStartEdit,
  onTrash,
  onToggleBlock,
  onToggleFavorite,
  onToggleMute,
  onTogglePin,
  onTogglePinnedMessage,
  onToggleReaction,
  onToggleStar,
  onSearchChange,
  pinnedMessages,
  replyTarget,
  onClearReplyTarget,
  onClearForwardMessage,
  showEmojiPicker,
  onToggleEmojiPicker
}) {
  const messageEndRef = useRef(null);
  const topSentinelRef = useRef(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lastMessageId, isTyping]);

  useEffect(() => {
    if (!topSentinelRef.current || !hasMoreMessages || loadingOlderMessages) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          onLoadOlder();
        }
      },
      { rootMargin: "60px" }
    );

    observer.observe(topSentinelRef.current);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreMessages, loadingOlderMessages, onLoadOlder]);

  const lastOutgoingMessageId = useMemo(() => {
    const lastOutgoingMessage = [...messages]
      .reverse()
      .find((message) => message.sender.id === currentUserId);

    return lastOutgoingMessage?.id || null;
  }, [currentUserId, messages]);

  const composerLocked =
    activeContact?.isBlocked ||
    activeContact?.hasBlockedYou ||
    activeContact?.isTrashed ||
    activeContact?.requestState === "pending" ||
    activeContact?.requestState === "sent";

  if (!activeContact) {
    return (
      <section className="chat-window chat-empty">
        <div>
          <h2>Select a contact</h2>
          <p>Choose a chat, request, or Notes to self from the sidebar.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`chat-window ${isDragging ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) {
          return;
        }
        setIsDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) {
          onAttachmentSelect(file);
        }
      }}
    >
      <header className="chat-header">
        <div className="chat-contact">
          <button className="ghost-button mobile-back-button" type="button" onClick={onBack}>
            Back
          </button>
          <Avatar user={activeContact} />
          <div>
            <h2>
              {activeContact.displayName || activeContact.name}
              {activeContact.isVerified ? " Verified" : ""}
            </h2>
            <p className={isTyping ? "typing-text" : ""}>{formatPresence(activeContact, isTyping)}</p>
            {activeContact.statusMessage ? <p>{activeContact.statusMessage}</p> : null}
          </div>
        </div>

        <div className="chat-actions">
          <button className="ghost-button subtle-button" type="button" onClick={onToggleFavorite}>
            {activeContact.isFavorite ? "Unfavorite" : "Favorite"}
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onSetNickname}>
            Nickname
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onSetLabels}>
            Labels
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onExportConversation}>
            Export
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onArchive}>
            {activeContact.isArchived ? "Unarchive" : "Archive"}
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onRestrict}>
            {activeContact.isRestricted ? "Unrestrict" : "Restrict"}
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onTrash}>
            {activeContact.isTrashed ? "Restore" : "Trash"}
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onTogglePin}>
            {activeContact.isPinned ? "Unpin" : "Pin"}
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onToggleMute}>
            {activeContact.isMuted ? "Unmute" : "Mute"}
          </button>
          <button className="ghost-button subtle-button" type="button" onClick={onToggleBlock}>
            {activeContact.isBlocked ? "Unblock" : "Block"}
          </button>
          <input
            className="chat-search-input"
            type="search"
            placeholder="Search messages"
            value={messageSearch}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </header>

      <div className="messages-panel">
        {pinnedMessages?.length ? (
          <div className="pinned-stack">
            {pinnedMessages.map((message) => (
              <div key={message.id} className="pinned-card">
                <strong>Pinned</strong>
                <span>{message.text || message.attachment?.name || "Attachment"}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div ref={topSentinelRef} />
        {loadingOlderMessages ? <p className="panel-state">Loading older messages...</p> : null}
        {loading ? (
          <div className="message-skeletons">
            <div className="message-skeleton incoming" />
            <div className="message-skeleton outgoing" />
            <div className="message-skeleton incoming" />
          </div>
        ) : null}
        {error ? <p className="panel-state panel-error">{error}</p> : null}
        {!loading && messages.length === 0 ? (
          <p className="panel-state">
            {messageSearch ? "No messages match your search." : "No messages yet. Send the first message."}
          </p>
        ) : null}

        {messages.map((message) => {
          const outgoing = message.sender.id === currentUserId;
          const showSeenState = outgoing && message.id === lastOutgoingMessageId;
          const isEditing = editingMessageId === message.id;

          return (
            <article
              key={message.id}
              className={`message-row ${outgoing ? "outgoing" : "incoming"}`}
            >
              <div className="message-stack">
                {isEditing ? (
                  <form
                    className="message-edit-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      onEditMessage(message.id);
                    }}
                  >
                    <input
                      value={editingText}
                      onChange={(event) => onEditingTextChange(event.target.value)}
                    />
                    <div className="message-edit-actions">
                      <button className="ghost-button subtle-button" type="submit">
                        Save
                      </button>
                      <button
                        className="ghost-button subtle-button"
                        type="button"
                        onClick={onCancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className={`message-bubble ${outgoing ? "outgoing" : "incoming"}`}>
                    {message.replyTo ? (
                      <div className="reply-preview">
                        <strong>{message.replyTo.senderName}</strong>
                        <span>{message.replyTo.text || message.replyTo.attachmentName || "Attachment"}</span>
                      </div>
                    ) : null}
                    {message.forwardedFrom ? <small>Forwarded from {message.forwardedFrom.name}</small> : null}
                    <p>{message.text}</p>
                    {message.linkPreview ? (
                      <a
                        className="link-preview"
                        href={message.linkPreview.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <strong>{message.linkPreview.domain}</strong>
                        <span>{message.linkPreview.url}</span>
                      </a>
                    ) : null}
                    {message.attachment ? (
                      message.attachment.mimeType?.startsWith("image/") ? (
                        <img
                          className="message-image"
                          src={message.attachment.dataUrl}
                          alt={message.attachment.name}
                        />
                      ) : (
                        <a
                          className="message-file"
                          href={message.attachment.dataUrl}
                          download={message.attachment.name}
                        >
                          {message.attachment.name}
                        </a>
                      )
                    ) : null}
                    <time dateTime={message.createdAt}>{formatTimestamp(message.createdAt)}</time>
                  </div>
                )}

                {!isEditing ? (
                  <div className="message-tools">
                    <div className="reaction-bar">
                      {reactionPalette.map((emoji) => {
                        const reaction = message.reactions.find((entry) => entry.emoji === emoji);
                        const isActive = reaction?.users.includes(currentUserId);

                        return (
                          <button
                            key={emoji}
                            className={`reaction-button ${isActive ? "is-active" : ""}`}
                            type="button"
                            onClick={() => onToggleReaction(message.id, emoji)}
                          >
                            {emoji} {reaction?.count || ""}
                          </button>
                        );
                      })}
                    </div>

                    {outgoing && !message.deletedAt ? (
                      <div className="message-action-row">
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onReplyToMessage(message)}
                        >
                          Reply
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onForwardMessage(message)}
                        >
                          Forward
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onToggleStar(message.id)}
                        >
                          {message.starredBy?.includes(currentUserId) ? "Unstar" : "Star"}
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onTogglePinnedMessage(message.id)}
                        >
                          {activeContact.pinnedMessageIds?.includes(message.id) ? "Unpin msg" : "Pin msg"}
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onStartEdit(message)}
                        >
                          Edit
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onDeleteMessage(message.id)}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                    {!outgoing && !message.deletedAt ? (
                      <div className="message-action-row">
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onReplyToMessage(message)}
                        >
                          Reply
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onForwardMessage(message)}
                        >
                          Forward
                        </button>
                        <button
                          className="ghost-button subtle-button"
                          type="button"
                          onClick={() => onToggleStar(message.id)}
                        >
                          {message.starredBy?.includes(currentUserId) ? "Unstar" : "Star"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {showSeenState ? (
                  <p className="message-status">
                    {message.seenAt ? `Seen ${formatTimestamp(message.seenAt)}` : "Delivered"}
                  </p>
                ) : null}
                {message.editedAt && !message.deletedAt ? (
                  <p className="message-status">Edited</p>
                ) : null}
              </div>
            </article>
          );
        })}

        {isTyping ? <p className="typing-indicator">{activeContact.name} is typing...</p> : null}
        <div ref={messageEndRef} />
      </div>

      {failedSend ? (
        <div className="composer-banner">
          <span>Last message failed to send.</span>
          <button className="ghost-button subtle-button" type="button" onClick={onRetryFailedSend}>
            Retry
          </button>
        </div>
      ) : null}

      {activeContact.requestState === "pending" ? (
        <div className="composer-banner">
          <span>{activeContact.name} sent you a message request.</span>
          <div className="message-edit-actions">
            <button className="ghost-button subtle-button" type="button" onClick={onAcceptRequest}>
              Accept
            </button>
            <button className="ghost-button subtle-button" type="button" onClick={onTrash}>
              Move to trash
            </button>
          </div>
        </div>
      ) : null}

      {activeContact.requestState === "sent" ? (
        <div className="composer-banner">
          <span>Message request sent. Wait for {activeContact.name} to accept it.</span>
        </div>
      ) : null}

      {activeContact.isTrashed ? (
        <div className="composer-banner">
          <span>This conversation is in trash.</span>
          <button className="ghost-button subtle-button" type="button" onClick={onRestoreFromTrash}>
            Restore
          </button>
        </div>
      ) : null}

      {activeContact.isBlocked || activeContact.hasBlockedYou ? (
        <div className="composer-banner panel-error">
          {activeContact.hasBlockedYou
            ? `${activeContact.name} blocked this conversation.`
            : "You blocked this conversation."}
        </div>
      ) : composerLocked ? null : (
        <form className="composer" onSubmit={onSend}>
          {replyTarget ? (
            <div className="composer-banner">
              <span>Replying to: {replyTarget.text || replyTarget.attachment?.name || "Attachment"}</span>
              <button className="ghost-button subtle-button" type="button" onClick={onClearReplyTarget}>
                Clear
              </button>
            </div>
          ) : null}

          {forwardMessage ? (
            <div className="composer-banner">
              <span>
                Forwarding: {forwardMessage.text || forwardMessage.attachment?.name || "Attachment"}
              </span>
              <button className="ghost-button subtle-button" type="button" onClick={onClearForwardMessage}>
                Clear
              </button>
            </div>
          ) : null}

          {attachment ? (
            <div className="attachment-preview">
              {attachment.mimeType.startsWith("image/") ? (
                <img src={attachment.dataUrl} alt={attachment.name} />
              ) : (
                <span>{attachment.name}</span>
              )}
              <button className="ghost-button subtle-button" type="button" onClick={onRemoveAttachment}>
                Remove
              </button>
            </div>
          ) : null}

          {showEmojiPicker ? (
            <div className="emoji-picker">
              {emojiPalette.map((emoji) => (
                <button key={emoji} type="button" onClick={() => onAppendEmoji(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}

          <div className="composer-row">
            <label className="ghost-button file-button composer-file">
              Attach
              <input
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp,.pdf,.txt"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    onAttachmentSelect(file);
                  }
                  event.target.value = "";
                }}
              />
            </label>
            <button className="ghost-button subtle-button" type="button" onClick={onToggleEmojiPicker}>
              Emoji
            </button>
            <input
              type="text"
              placeholder={`Message ${activeContact.name}`}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <button
              className="primary-button"
              type="submit"
              disabled={!draft.trim() && !attachment && !forwardMessage}
            >
              Send
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
