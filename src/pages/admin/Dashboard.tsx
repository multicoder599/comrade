import { trpc } from "@/providers/trpc";
import { formatKes, formatQty } from "@/lib/money";
import { eatDayRange } from "@/lib/dates";
import { StatusBadge } from "@/pages/Pos";
import { AlertTriangle } from "lucide-react";

export default function Dashboard() {
  const { from, to } = eatDayRange(0);
  const summary = trpc.reports.summary.useQuery({ from, to });
  const lowStock = trpc.reports.lowStock.useQuery({ threshold: 10 });
  const recent = trpc.sales.list.useQuery({ limit: 10 });

  const d = summary.data;

  return (
    <div className="space-y-6">
      <div>
        <p className="micro-label">Today</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Dashboard
        </h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Revenue today" value={d ? formatKes(d.revenue) : "—"} />
        <StatCard
          label="Profit today"
          value={d ? formatKes(d.profit) : "—"}
          accent
        />
        <StatCard label="Sales today" value={d ? String(d.sales) : "—"} />
        <StatCard
          label="Discounts given"
          value={d ? formatKes(d.discountTotal) : "—"}
        />
      </div>

      {/* Per-shop */}
      <div className="grid md:grid-cols-2 gap-3">
        {(d?.shops ?? []).map((s) => (
          <div key={s.shop} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="font-display font-semibold">Shop {s.shop}</p>
              <span className="micro-label">{s.sales} sales</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div>
                <p className="micro-label">Revenue</p>
                <p className="font-figures font-semibold mt-0.5">{formatKes(s.revenue)}</p>
              </div>
              <div>
                <p className="micro-label">Cost</p>
                <p className="font-figures mt-0.5 text-muted-foreground">{formatKes(s.cost)}</p>
              </div>
              <div>
                <p className="micro-label">Profit</p>
                <p className="font-figures font-semibold mt-0.5 text-primary">
                  {formatKes(s.profit)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Recent sales */}
        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="font-display font-semibold">Latest sales</h2>
          </header>
          <ul className="divide-y divide-border">
            {(recent.data ?? []).map((sale) => (
              <li key={sale.id} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="font-figures text-xs text-muted-foreground w-20">
                  {new Date(sale.createdAt).toLocaleTimeString("en-KE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="font-medium truncate flex-1">{sale.receiptNo}</span>
                <span className="text-xs text-muted-foreground">
                  {sale.paymentMethod === "megapay" ? "M-Pesa" : "Cash"}
                </span>
                <StatusBadge status={sale.status} />
                <span className="font-figures font-semibold w-24 text-right">
                  {formatKes(sale.total)}
                </span>
              </li>
            ))}
            {(recent.data ?? []).length === 0 && (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                No sales recorded yet.
              </li>
            )}
          </ul>
        </section>

        {/* Low stock */}
        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            <h2 className="font-display font-semibold">Low stock</h2>
          </header>
          <ul className="divide-y divide-border">
            {(lowStock.data ?? []).map((row) => (
              <li key={`${row.id}-${row.shop}`} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{row.name}</span>
                <span className="text-xs text-muted-foreground">Shop {row.shop}</span>
                <span
                  className={`font-figures font-semibold ${
                    row.qty <= 0 ? "text-destructive" : "text-warning"
                  }`}
                >
                  {formatQty(row.qty)} {row.unit}
                </span>
              </li>
            ))}
            {(lowStock.data ?? []).length === 0 && (
              <li className="px-4 py-6 text-sm text-muted-foreground">
                Everything is well stocked.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="micro-label">{label}</p>
      <p
        className={`font-figures text-xl font-semibold mt-1.5 tracking-tight ${
          accent ? "text-primary" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
