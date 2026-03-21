export default function QuickActionMenu({ items, onSelect }) {
  return (
    <div
      className="absolute right-0 top-[calc(100%+10px)] z-20 w-[280px] rounded-[18px] p-2"
      style={{
        border: "1px solid rgba(255,255,255,0.1)",
        background: "linear-gradient(180deg, rgba(17,24,39,0.98), rgba(15,22,35,0.98))",
        boxShadow: "0 24px 60px rgba(0,0,0,0.42)"
      }}
    >
      <div className="px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Quick actions
      </div>
      <div className="space-y-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className="flex w-full items-start gap-3 rounded-[14px] px-3 py-3 text-left transition hover:bg-white/6"
          >
            <span
              className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base"
              style={{
                background: `${item.accent}18`,
                border: `1px solid ${item.accent}33`,
                color: item.accent
              }}
            >
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-100">{item.label}</span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">{item.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
