import { orderRows, orderStatusMeta } from "@/lib/admin-data";
import { cn } from "@/lib/utils";

const badge: Record<string, string> = {
  success: "bg-success/15 text-success",
  primary: "bg-primary/15 text-primary",
  accent: "bg-accent/15 text-accent",
  muted: "bg-foreground/10 text-muted-foreground",
};

export function OrdersTable() {
  return (
    <div className="rounded-2xl glass">
      <div className="flex items-center justify-between p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">Live orders</h2>
          <p className="text-xs text-muted-foreground">Updated moments ago</p>
        </div>
        <button className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          View all
        </button>
      </div>

      {/* The table scrolls inside its own container so the page never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead>
            <tr className="border-y border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="px-6 py-3 font-medium">Order</th>
              <th scope="col" className="px-6 py-3 font-medium">Customer</th>
              <th scope="col" className="px-6 py-3 font-medium">Service</th>
              <th scope="col" className="px-6 py-3 font-medium">Amount</th>
              <th scope="col" className="px-6 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {orderRows.map((o) => {
              const meta = orderStatusMeta[o.status];
              return (
                <tr key={o.code} className="border-b border-border/60 transition-colors last:border-0 hover:bg-foreground/[0.03]">
                  <td className="px-6 py-3.5 font-medium">{o.code}</td>
                  <td className="px-6 py-3.5 text-muted-foreground">{o.customer}</td>
                  <td className="px-6 py-3.5 text-muted-foreground">{o.service}</td>
                  <td className="px-6 py-3.5 font-medium tabular-nums">{o.amount}</td>
                  <td className="px-6 py-3.5">
                    <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", badge[meta.tint])}>
                      {meta.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
