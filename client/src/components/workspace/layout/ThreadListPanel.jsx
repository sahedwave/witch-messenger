import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";

import {
  avatarForThread,
  canSeeThread,
  financeThreadDescriptor,
  relativeTime,
  useThreadList
} from "../WorkspaceMessenger.utils.js";

export default function ThreadListPanel({ role, activeNav, activeThreadId, onOpenThread, filter, onFilterChange, search, onSearchChange, financeMode, workspaceScope, workspaceMode }) {
  const { threads } = useThreadList();
  const showWorkspaceOverviewPanel = activeNav === "home";
  const showWorkspaceUsersPanel = activeNav === "users";
  const threadPanelStyle = financeMode
    ? {
        width: "clamp(232px, 24vw, 300px)",
        minWidth: 232,
        maxWidth: 300,
        boxShadow: "inset -1px 0 0 rgba(255,255,255,0.04)"
      }
    : {
        width: "clamp(232px, 24vw, 300px)",
        minWidth: 232,
        maxWidth: 300
      };
  const visibleThreads = useMemo(() => {
    return threads
      .filter((thread) => canSeeThread(thread, role, workspaceScope, workspaceMode))
      .filter((thread) => {
        if (filter === "archived") {
          return thread.archived;
        }
        return !thread.archived;
      })
      .filter((thread) => thread.name.toLowerCase().includes(search.toLowerCase()));
  }, [filter, role, search, threads, workspaceMode, workspaceScope]);

  if (showWorkspaceOverviewPanel) {
    return (
      <section
        className={`flex h-full flex-col px-4 py-5 ${financeMode ? "border-r border-white/5 bg-[#0d1420]" : "border-r border-slate-200 bg-white"}`}
        style={threadPanelStyle}
      >
        <div className="mb-4">
          <h2
            className={`${financeMode ? "text-white" : "text-slate-900"}`}
            style={{ fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em" }}
          >
            Overview
          </h2>
          <p className={`mt-2 text-sm leading-6 ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
            Your workspace front door for operational health, attention items, and the fastest path into Finance and Warehouse.
          </p>
        </div>

        <div
          className="rounded-[18px] p-4"
          style={
            financeMode
              ? {
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)"
                }
              : {
                  border: "1px solid rgba(148,163,184,0.16)",
                  background: "#f8fafc"
                }
          }
        >
          <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>
            Operations view
          </div>
          <div className={`mt-3 text-sm leading-6 ${financeMode ? "text-slate-300" : "text-slate-600"}`}>
            Use this space to spot overdue finance work, warehouse pressure, and overall business momentum before diving into a specific module.
          </div>
        </div>

        <div
          className="mt-4 rounded-[18px] p-4"
          style={
            financeMode
              ? {
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)"
                }
              : {
                  border: "1px solid rgba(148,163,184,0.16)",
                  background: "#f8fafc"
                }
          }
        >
          <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-emerald-300" : "text-slate-500"}`}>
            Best for
          </div>
          <div className={`mt-3 space-y-2 text-sm ${financeMode ? "text-slate-300" : "text-slate-600"}`}>
            <div>Owner or manager users checking what needs attention.</div>
            <div>Both-module workspaces that need one operational picture.</div>
            <div>Fast entry into the right module once priorities are clear.</div>
          </div>
        </div>
      </section>
    );
  }

  if (showWorkspaceUsersPanel) {
    return (
      <section
        className={`flex h-full flex-col px-4 py-5 ${financeMode ? "border-r border-white/5 bg-[#0d1420]" : "border-r border-slate-200 bg-white"}`}
        style={threadPanelStyle}
      >
        <div className="mb-4">
          <h2
            className={`${financeMode ? "text-white" : "text-slate-900"}`}
            style={{ fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em" }}
          >
            Workspace
          </h2>
          <p className={`mt-2 text-sm leading-6 ${financeMode ? "text-slate-400" : "text-slate-500"}`}>
            Manage members, roles, and module access from the settings panel on the right.
          </p>
        </div>

        <div
          className="rounded-[18px] p-4"
          style={
            financeMode
              ? {
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)"
                }
              : {
                  border: "1px solid rgba(148,163,184,0.16)",
                  background: "#f8fafc"
                }
          }
        >
          <div className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${financeMode ? "text-cyan-300" : "text-slate-500"}`}>
            Workspace admin
          </div>
          <div className={`mt-3 text-sm leading-6 ${financeMode ? "text-slate-300" : "text-slate-600"}`}>
            This area is separate from FinanceBot and WareBot so workspace administration stays clear and doesn’t get mixed into chat threads.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`flex h-full flex-col px-4 py-5 ${financeMode ? "border-r border-white/5 bg-[#0d1420]" : "border-r border-slate-200 bg-white"}`}
      style={threadPanelStyle}
    >
      <div className="mb-4">
        <h2
          className={`${financeMode ? "text-white" : "text-slate-900"}`}
          style={{ fontFamily: '"Sora","Manrope","DM Sans","Segoe UI",sans-serif', fontSize: 20, fontWeight: 700, letterSpacing: "-0.03em" }}
        >
          Inbox
        </h2>
        <div
          className="mt-3 flex rounded-full p-1 text-sm font-semibold"
          style={
            financeMode
              ? { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b" }
              : { background: "#f1f5f9", color: "#64748b" }
          }
        >
          {[
            { id: "inbox", label: "Drafts" },
            { id: "archived", label: "Archived" }
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onFilterChange(item.id === "inbox" ? "inbox" : "archived")}
              className="flex-1 rounded-full px-4 py-2 transition"
              style={
                filter === (item.id === "inbox" ? "inbox" : "archived")
                  ? financeMode
                    ? {
                        background: "rgba(255,255,255,0.1)",
                        color: "#fff"
                      }
                    : {
                        background: "#fff",
                        color: "#0f172a",
                        boxShadow: "0 1px 3px rgba(15,23,42,0.08)"
                      }
                  : undefined
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="mb-4 rounded-xl px-4 py-3"
        style={
          financeMode
            ? { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }
            : { background: "#f1f5f9" }
        }
      >
        <div className="flex items-center gap-2">
          {financeMode ? <span className="text-sm text-slate-500">🔍</span> : null}
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={financeMode ? "Search threads..." : "Search inbox threads"}
            className={`w-full border-none bg-transparent text-sm outline-none ${financeMode ? "text-slate-100 placeholder:text-slate-600" : "text-slate-700 placeholder:text-slate-400"}`}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-1">
        <AnimatePresence initial={false}>
          {visibleThreads.map((thread) => {
            const avatar = avatarForThread(thread);
            const descriptor = financeThreadDescriptor(thread);
            return (
              <motion.button
                key={thread.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                type="button"
                onClick={() => onOpenThread(thread.id)}
                className="mb-2.5 w-full rounded-[14px] border px-3 py-3 text-left transition"
                style={
                  financeMode
                    ? activeThreadId === thread.id
                      ? {
                          minHeight: 72,
                          background: thread.id === "financebot"
                            ? "linear-gradient(90deg, rgba(16,185,129,0.14), rgba(16,185,129,0.03))"
                            : "rgba(255,255,255,0.03)",
                          borderColor: thread.id === "financebot" ? "rgba(16,185,129,0.18)" : "rgba(255,255,255,0.08)",
                          boxShadow: thread.id === "financebot" ? "inset 2px 0 0 #10b981" : "none"
                        }
                      : {
                          minHeight: 72,
                          background: "transparent",
                          borderColor: "transparent"
                        }
                    : activeThreadId === thread.id
                      ? {
                          borderColor: "rgba(45,142,255,0.2)",
                          background: "#F6FAFF",
                          boxShadow: "0 1px 3px rgba(15,23,42,0.08)"
                        }
                      : {
                          borderColor: "transparent",
                          background: "#fff"
                        }
                }
              >
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-2xl ${avatar.fg}`}
                      style={
                        financeMode
                          ? thread.id === "financebot"
                            ? {
                                background: descriptor.bg,
                                border: `2px solid ${descriptor.ring}`
                              }
                            : thread.id === "warebot"
                              ? {
                                  background: descriptor.bg,
                                  border: `2px solid ${descriptor.ring}`
                                }
                              : {
                                  background: descriptor.bg,
                                  border: `1px solid ${descriptor.ring}`,
                                  color: "#fff"
                                }
                          : undefined
                      }
                    >
                      {avatar.label}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 ${financeMode ? "border-[#0d1420]" : "border-white"} ${thread.online ? "bg-emerald-400" : "bg-slate-300"}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-sm ${financeMode ? (thread.unread ? "font-bold text-white" : "font-semibold text-slate-200") : thread.unread ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
                        {thread.isBot ? `${thread.id === "financebot" ? "💰" : "📦"} ${thread.name}` : thread.name}
                      </span>
                      <span className={`ml-auto shrink-0 text-xs ${financeMode ? "text-slate-500" : "text-slate-400"}`}>{relativeTime(thread.updatedAt)}</span>
                    </div>
                    {financeMode && thread.isBot ? (
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: descriptor.accent }}>
                        {descriptor.label}
                      </p>
                    ) : null}
                    <p className={`mt-1 truncate text-sm ${financeMode ? (thread.unread ? "font-medium text-slate-400" : "text-slate-500") : thread.unread ? "font-semibold text-slate-700" : "text-slate-500"}`}>
                      {thread.preview}
                    </p>
                  </div>
                  {thread.unread ? (
                    <motion.span
                      key={`${thread.id}-${thread.unread}`}
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="inline-flex min-w-6 items-center justify-center rounded-full px-2 text-xs font-bold text-white"
                      style={{ background: financeMode ? (thread.id === "financebot" ? "#10b981" : "#f59e0b") : "#2D8EFF" }}
                    >
                      {thread.unread}
                    </motion.span>
                  ) : null}
                </div>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
