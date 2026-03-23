export function Toasts({ toasts }) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <article key={toast.id} className="toast-card">
          <strong>{toast.title}</strong>
          <p>{toast.body}</p>
        </article>
      ))}
    </div>
  );
}

