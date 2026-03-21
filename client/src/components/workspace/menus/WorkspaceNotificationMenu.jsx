import { buildNotificationToneStyles, formatTimeAgo, workspaceNotificationIcon } from "../WorkspaceMessenger.utils.js";

export default function WorkspaceNotificationMenu({
  financeMode = false,
  unreadCount = 0,
  notifications = [],
  loading = false,
  onOpenNotification = null,
  onMarkAllRead = null,
  markAllLoading = false
}) {
  return (
    <div
      className="absolute right-0 top-[calc(100%+10px)] z-30 w-[340px] rounded-[20px] p-2"
      style={{
        border: financeMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid #e2e8f0",
        background: financeMode
          ? "linear-gradient(180deg, rgba(17,24,39,0.98), rgba(15,22,35,0.98))"
          : "#ffffff",
        boxShadow: financeMode ? "0 24px 60px rgba(0,0,0,0.42)" : "0 24px 50px rgba(15,23,42,0.12)"
      }}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <div>
          <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-slate-500" : "text-slate-500"}`}>
            Notifications
          </div>
          <div className={`mt-1 text-sm ${financeMode ? "text-slate-300" : "text-slate-600"}`}>
            {unreadCount ? `${unreadCount} unread` : "All caught up"}
          </div>
        </div>
        <button
          type="button"
          onClick={onMarkAllRead}
          disabled={!unreadCount || !onMarkAllRead || markAllLoading}
          className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
            financeMode
              ? "border border-white/10 bg-white/5 text-slate-200 disabled:text-slate-500"
              : "border border-slate-200 bg-slate-50 text-slate-600 disabled:text-slate-400"
          }`}
        >
          {markAllLoading ? "Marking..." : "Mark all read"}
        </button>
      </div>
      <div className="max-h-[380px] overflow-y-auto px-1 pb-1">
        {loading ? (
          <div className={`rounded-[16px] px-4 py-5 text-sm ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
            Loading notifications...
          </div>
        ) : notifications.length ? (
          notifications.map((notification) => {
            const toneStyles = buildNotificationToneStyles(
              notification?.type === "task_overdue"
                ? "danger"
                : notification?.type === "task_due_soon"
                  ? "warning"
                  : "info",
              financeMode
            );

            return (
              <button
                key={notification.id}
                type="button"
                onClick={() => onOpenNotification?.(notification)}
                className={`mb-1 flex w-full items-start gap-3 rounded-[16px] px-3 py-3 text-left transition ${
                  financeMode ? "hover:bg-white/6" : "hover:bg-slate-50"
                }`}
              >
                <span
                  className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold"
                  style={toneStyles}
                >
                  {workspaceNotificationIcon(notification.type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-semibold ${financeMode ? "text-slate-100" : "text-slate-800"}`}>
                    {notification.message}
                  </span>
                  <span className={`mt-1 block text-xs ${financeMode ? "text-slate-500" : "text-slate-500"}`}>
                    {formatTimeAgo(notification.createdAt)}
                  </span>
                </span>
              </button>
            );
          })
        ) : (
          <div
            className={`rounded-[16px] px-4 py-8 text-center text-sm ${
              financeMode ? "text-slate-400" : "text-slate-500"
            }`}
          >
            No unread assignment notifications right now.
          </div>
        )}
      </div>
    </div>
  );
}
