function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12.75a4.5 4.5 0 1 0-4.5-4.5 4.5 4.5 0 0 0 4.5 4.5Zm0 2.25c-3.6 0-6.75 1.84-8.55 4.63a.75.75 0 0 0 .64 1.17h15.82a.75.75 0 0 0 .64-1.17C18.75 16.84 15.6 15 12 15Z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 5.25A2.25 2.25 0 0 0 2.25 7.5v9A2.25 2.25 0 0 0 4.5 18.75h15A2.25 2.25 0 0 0 21.75 16.5v-9A2.25 2.25 0 0 0 19.5 5.25h-15Zm15.3 2.15L12 12.67 4.2 7.4a.75.75 0 0 1 .42-1.4h14.76a.75.75 0 0 1 .42 1.4Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 1.5a4.5 4.5 0 0 0-4.5 4.5v2.25H6A2.25 2.25 0 0 0 3.75 10.5v9A2.25 2.25 0 0 0 6 21.75h12A2.25 2.25 0 0 0 20.25 19.5v-9A2.25 2.25 0 0 0 18 8.25h-1.5V6A4.5 4.5 0 0 0 12 1.5Zm-3 6.75V6a3 3 0 1 1 6 0v2.25H9Zm3 3a1.875 1.875 0 0 0-.75 3.59v1.41a.75.75 0 0 0 1.5 0v-1.41A1.875 1.875 0 0 0 12 11.25Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.25a.75.75 0 0 0-.32.07l-7.5 3.5a.75.75 0 0 0-.43.68v4.1c0 5.02 3.03 9.68 7.7 11.84a1.5 1.5 0 0 0 1.1 0c4.67-2.16 7.7-6.82 7.7-11.84V6.5a.75.75 0 0 0-.43-.68l-7.5-3.5a.75.75 0 0 0-.32-.07Zm3.18 7.8-3.75 4.5a.75.75 0 0 1-1.11.05l-1.5-1.5a.75.75 0 1 1 1.06-1.06l.92.92 3.17-3.8a.75.75 0 1 1 1.21.89Z" />
    </svg>
  );
}

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5.25c-4.9 0-8.9 3.2-10.3 6.75 1.4 3.55 5.4 6.75 10.3 6.75s8.9-3.2 10.3-6.75C20.9 8.45 16.9 5.25 12 5.25Zm0 10.5A3.75 3.75 0 1 1 15.75 12 3.75 3.75 0 0 1 12 15.75Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3.53 2.47-1.06 1.06 3.09 3.09A12.6 12.6 0 0 0 1.7 12c1.4 3.55 5.4 6.75 10.3 6.75 1.99 0 3.83-.52 5.43-1.36l3.04 3.04 1.06-1.06L3.53 2.47Zm8.47 13.28A3.75 3.75 0 0 1 8.25 12c0-.49.1-.95.27-1.38l4.86 4.86c-.43.17-.89.27-1.38.27Zm0-10.5c-1.69 0-3.28.38-4.68 1.02l1.1 1.1A5.22 5.22 0 0 1 12 6.75a5.25 5.25 0 0 1 5.25 5.25c0 .9-.23 1.74-.64 2.47l1.1 1.1c1.95-1.28 3.44-3.22 4.59-5.57-1.4-3.55-5.4-6.75-10.3-6.75Z" />
    </svg>
  );
}

const iconMap = {
  user: UserIcon,
  mail: MailIcon,
  lock: LockIcon,
  shield: ShieldIcon
};

export function AuthField({
  label,
  error,
  hint,
  icon = "mail",
  action,
  inputClassName = "",
  ...inputProps
}) {
  const Icon = iconMap[icon] || MailIcon;

  return (
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      <div
        className={`auth-input-shell ${error ? "has-error" : ""} ${inputClassName}`.trim()}
      >
        <span className="auth-input-icon">
          <Icon />
        </span>
        <input {...inputProps} />
        {action ? <div className="auth-input-action">{action}</div> : null}
      </div>
      {hint ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

export function VisibilityButton({ open, onClick }) {
  return (
    <button
      className="auth-visibility-button"
      type="button"
      onClick={onClick}
      aria-label={open ? "Hide password" : "Show password"}
    >
      <EyeIcon open={open} />
    </button>
  );
}
