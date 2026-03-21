import { motion } from "framer-motion";

import { NAV_ITEMS } from "../WorkspaceMessenger.constants.js";
import { canSeeNavItem, roleBadgeStyle, useUnread } from "../WorkspaceMessenger.utils.js";

export default function Sidebar({ activeNav, onNavChange, currentUser, settings, onToggleSound, financeMode, workspaceScope }) {
  const { totalUnread } = useUnread();
  const badgeStyle = roleBadgeStyle(currentUser.role);
  const sidebarStyle = financeMode
    ? {
        width: "clamp(184px, 18vw, 220px)",
        minWidth: 184,
        maxWidth: 220,
        boxShadow: "inset -1px 0 0 rgba(255,255,255,0.04)"
      }
    : {
        width: "clamp(184px, 18vw, 220px)",
        minWidth: 184,
        maxWidth: 220
      };

  return (
    <aside
      className={`flex h-full flex-col px-4 py-4 ${financeMode ? "border-r border-white/5 bg-[#080d16] text-white" : "border-r border-slate-200 bg-[#F5F6FA]"}`}
      style={sidebarStyle}
    >
      <div className="mb-6 flex items-center gap-3">
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl text-xl font-bold text-white ${financeMode ? "" : "bg-[#2D8EFF]"}`}
          style={
            financeMode
              ? {
                  background: "linear-gradient(135deg,#10b981,#059669)",
                  boxShadow: "0 0 24px rgba(16,185,129,0.3)"
                }
              : undefined
          }
        >
          W
        </div>
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.22em] ${financeMode ? "text-slate-500" : "text-slate-400"}`}>Workspace</p>
          <h1
            className={`${financeMode ? "text-white" : "text-slate-900"}`}
            style={{ fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 13, fontWeight: 700 }}
          >
            Business Messenger
          </h1>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1.5">
        {NAV_ITEMS.filter((item) => canSeeNavItem(item.id, workspaceScope)).map((item) => {
          const active = activeNav === item.id;
          const showBadge = item.id === "inbox" && totalUnread > 0;
          const financeActive = financeMode && active && item.id === "finances";
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavChange(item.id)}
              className={`relative flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                financeMode
                  ? active
                    ? "text-white"
                    : "text-slate-400 hover:bg-white/4 hover:text-slate-200"
                  : active
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:bg-white hover:text-slate-900"
              }`}
              style={
                financeMode && active
                  ? {
                      background: financeActive
                        ? "linear-gradient(90deg, rgba(16,185,129,0.16), rgba(16,185,129,0.04))"
                        : "rgba(255,255,255,0.06)"
                    }
                  : undefined
              }
            >
              {financeMode && active ? (
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-full"
                  style={{ background: financeActive ? "#10b981" : "#60a5fa", boxShadow: financeActive ? "0 0 12px rgba(16,185,129,0.45)" : "0 0 10px rgba(96,165,250,0.35)" }}
                />
              ) : null}
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-base ${
                financeMode
                  ? active
                    ? "bg-white/10 text-white"
                    : "bg-white/5 text-slate-400"
                  : active
                    ? "bg-[#E8F2FF] text-[#2D8EFF]"
                    : "bg-slate-100 text-slate-500"
              }`}>
                {item.icon}
              </span>
              <span className="flex-1 font-medium">{item.label}</span>
              {showBadge ? (
                <motion.span
                  key={totalUnread}
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold text-white"
                  style={{ background: financeMode ? "rgba(100,116,139,0.5)" : "#2D8EFF" }}
                >
                  {totalUnread}
                </motion.span>
              ) : null}
              {financeMode && financeActive ? (
                <span
                  className="ml-auto inline-flex rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em]"
                  style={{
                    background: "rgba(16,185,129,0.18)",
                    border: "1px solid rgba(16,185,129,0.3)",
                    color: "#10b981"
                  }}
                >
                  Active
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {financeMode ? (
        <div
          className="mb-4 rounded-xl px-3 py-2"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)"
          }}
        >
          <div className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Testing role</div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-[rgba(255,255,255,0.03)] px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              <span className="text-sm font-semibold text-white capitalize">{currentUser.role}</span>
            </div>
            <span className="text-slate-500">▾</span>
          </div>
        </div>
      ) : null}

      <div
        className={`mt-4 rounded-2xl p-3 ${financeMode ? "" : "border border-slate-200 bg-white shadow-sm"}`}
        style={
          financeMode
            ? {
                border: "1px solid rgba(255,255,255,0.07)",
                background: "rgba(255,255,255,0.04)"
              }
            : undefined
        }
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold"
              style={
                financeMode
                  ? { background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff" }
                  : { background: "#E8F2FF", color: "#2D8EFF" }
              }
            >
              {currentUser.name
                .split(/\s+/)
                .map((part) => part[0])
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
            {financeMode ? (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -1,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  background: "#10b981",
                  border: "2px solid #080d16"
                }}
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className={`truncate text-sm font-semibold ${financeMode ? "text-white" : "text-slate-900"}`}>{currentUser.name}</p>
            <div
              className="mt-1 inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold capitalize"
              style={badgeStyle}
            >
              {currentUser.role}
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleSound}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full transition"
            style={
              financeMode
                ? { border: "1px solid rgba(255,255,255,0.1)", color: "#cbd5e1" }
                : undefined
            }
            title={settings.soundEnabled ? "Sound on" : "Sound off"}
          >
            {settings.soundEnabled ? "🔔" : "🔕"}
          </button>
        </div>
      </div>
    </aside>
  );
}
