import { useState } from "react";

export default function FinanceContactManagerPanel({
  title,
  kind = "customer",
  items = [],
  accent = "#10b981",
  saving = false,
  canManage = false,
  onSave
}) {
  const [draft, setDraft] = useState({
    id: null,
    name: "",
    email: "",
    phone: "",
    contactName: "",
    notes: "",
    status: "active"
  });

  function resetDraft() {
    setDraft({
      id: null,
      name: "",
      email: "",
      phone: "",
      contactName: "",
      notes: "",
      status: "active"
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const saved = await onSave?.(draft);
    if (saved) {
      resetDraft();
    }
  }

  return (
    <div
      className="rounded-[24px] p-5"
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(180deg,#111827 0%,#10192a 100%)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.28)"
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accent }}>{kind}</div>
          <h3 className="mt-2 text-xl font-bold text-white">{title}</h3>
          <p className="mt-2 text-sm text-slate-400">Keep your finance contacts workspace-specific and ready to reuse while creating invoices or expenses.</p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)]">
        <div className="space-y-3">
          {items.length ? items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setDraft({
                id: item.id,
                name: item.name || "",
                email: item.email || "",
                phone: item.phone || "",
                contactName: item.contactName || "",
                notes: item.notes || "",
                status: item.status || "active"
              })}
              className="w-full rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-left transition hover:bg-white/8"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                  <div className="mt-1 text-xs text-slate-400">{item.email || "No email saved"}</div>
                  {item.contactName ? <div className="mt-1 text-xs text-slate-500">Contact: {item.contactName}</div> : null}
                </div>
                <span
                  className="rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
                  style={{
                    borderColor: item.status === "inactive" ? "rgba(148,163,184,0.22)" : `${accent}33`,
                    background: item.status === "inactive" ? "rgba(148,163,184,0.12)" : `${accent}18`,
                    color: item.status === "inactive" ? "#94a3b8" : accent
                  }}
                >
                  {item.status || "active"}
                </span>
              </div>
            </button>
          )) : (
            <div className="rounded-[18px] border border-white/8 bg-white/5 px-4 py-4 text-sm text-slate-400">
              No {kind} records yet.
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="grid gap-3 rounded-[20px] border border-white/8 bg-white/4 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            {draft.id ? `Edit ${kind}` : `Add ${kind}`}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Name</span>
            <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Email</span>
            <input type="email" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Phone</span>
              <input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Contact Name</span>
              <input value={draft.contactName} onChange={(event) => setDraft((current) => ({ ...current, contactName: event.target.value }))} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none" />
            </label>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Status</span>
            <select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Notes</span>
            <textarea rows={3} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} className="w-full rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-100 outline-none" />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            {draft.id ? (
              <button type="button" onClick={resetDraft} className="h-10 rounded-[12px] border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-300">
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!canManage || saving}
              className="h-10 rounded-[12px] px-5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: `linear-gradient(135deg,${accent},${accent})`, boxShadow: `0 14px 28px ${accent}33` }}
            >
              {saving ? "Saving..." : draft.id ? `Save ${kind}` : `Add ${kind}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

