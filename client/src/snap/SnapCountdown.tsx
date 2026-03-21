type SnapCountdownProps = {
  totalSeconds: number;
  secondsLeft: number;
  label?: string;
};

export default function SnapCountdown({
  totalSeconds,
  secondsLeft,
  label = "seconds left"
}: SnapCountdownProps) {
  const normalizedTotal = Math.max(totalSeconds, 1);
  const progress = Math.max(0, Math.min(1, secondsLeft / normalizedTotal));
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - progress);

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-950/55 px-3 py-2 text-white backdrop-blur"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.15)",
        background: "rgba(15,23,42,0.55)",
        padding: "8px 12px",
        color: "#ffffff"
      }}
    >
      <svg className="h-10 w-10 -rotate-90" viewBox="0 0 44 44" aria-hidden="true" style={{ width: 40, height: 40, transform: "rotate(-90deg)" }}>
        <circle cx="22" cy="22" r={radius} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="4" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="white"
          strokeWidth="4"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
        />
      </svg>
      <div className="leading-tight" style={{ lineHeight: 1.1 }}>
        <strong className="block text-sm" style={{ display: "block", fontSize: 14 }}>{secondsLeft}s</strong>
        <span className="block text-[11px] uppercase tracking-[0.18em] text-white/65" style={{ display: "block", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(255,255,255,0.65)" }}>{label}</span>
      </div>
    </div>
  );
}
