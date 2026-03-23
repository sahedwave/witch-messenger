import { Avatar } from "./Avatar";

function getStatusTone(contact) {
  if (contact.presenceStatus === "online") {
    return "online";
  }

  if (contact.presenceStatus === "away") {
    return "away";
  }

  return "offline";
}

export function ChatListItem({ active, contact, onSelect, preview, subtitle, timeText }) {
  return (
    <button
      type="button"
      className={`contact-card ${active ? "is-active" : ""}`}
      onClick={onSelect}
    >
      <span className="avatar-shell">
        <Avatar user={contact} />
        <span
          className={`avatar-status avatar-status-${getStatusTone(contact)}`}
          aria-hidden="true"
        />
      </span>

      <span className="contact-body">
        <span className="contact-heading">
          <strong title={contact.displayName || contact.name}>{contact.displayName || contact.name}</strong>
          {timeText ? <span className="contact-time">{timeText}</span> : null}
        </span>

        <span className={`contact-preview ${contact.isTyping ? "is-typing" : ""}`} title={preview}>
          {preview}
        </span>

        <span className="contact-footer">
          <span className="contact-subtitle">{subtitle}</span>
          {contact.labels?.length ? (
            <span className="contact-labels" title={contact.labels[0]}>
              {contact.labels[0]}
            </span>
          ) : null}
        </span>
      </span>

      <span className="contact-meta">
        {contact.unread > 0 ? (
          <span className="unread-badge" aria-label={`${contact.unread} unread messages`}>
            {contact.unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}
