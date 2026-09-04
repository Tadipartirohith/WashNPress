import { weeklyRevenue } from "@/lib/admin-data";

// A weekly revenue chart drawn in pure CSS. The plot area has a fixed height, so each
// bar's percentage height resolves against a real number of pixels rather than
// collapsing to nothing — the one thing a percentage-height bar chart has to get right.
export function RevenueChart() {
  const max = Math.max(...weeklyRevenue.map((d) => d.value));
  const peak = weeklyRevenue.reduce((a, b) => (b.value > a.value ? b : a));

  return (
    <div className="rounded-2xl p-5 glass sm:p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-display text-lg font-semibold">Weekly revenue</h2>
          <p className="text-xs text-muted-foreground">Last 7 days · in ₹ thousands</p>
        </div>
        <span className="rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
          +18.6% vs last week
        </span>
      </div>

      {/* Fixed-height plot area so the percentage bar heights have something to resolve against. */}
      <div className="mt-6 flex h-56 items-end gap-2 sm:gap-3">
        {weeklyRevenue.map((d) => {
          const heightPct = Math.round((d.value / max) * 100);
          const isPeak = d.day === peak.day;
          return (
            <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">{d.value}</span>
              <div
                className={`w-full rounded-t-lg transition-all duration-500 ${
                  isPeak
                    ? "bg-gradient-to-t from-primary to-accent shadow-glow"
                    : "bg-gradient-to-t from-primary/70 to-primary/30"
                }`}
                style={{ height: `${heightPct}%` }}
                role="img"
                aria-label={`${d.day}: ₹${d.value},000`}
              />
              <span className="text-xs text-muted-foreground">{d.day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
