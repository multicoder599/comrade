import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { trpc } from "@/providers/trpc";
import { formatKes } from "@/lib/money";
import {
  DebtBalance,
  DebtDetailDialog,
  DebtStatusBadge,
} from "./DebtDetailDialog";
import { Search, Wallet } from "lucide-react";

type Filter = "pending" | "closed" | "credit" | "all";

// Full-page cashier debt book: pending tabs, closed tabs, and customers with
// store credit from overpaying.
export function DebtsView({
  onReceipt,
}: {
  onReceipt: (saleId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("pending");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listQuery = trpc.debts.list.useQuery(
    {
      search: search || undefined,
      activeOnly: filter === "pending",
      status: filter === "closed" ? "settled" : undefined,
    },
    { placeholderData: (prev) => prev },
  );
  const customersQuery = trpc.debts.customers.useQuery();

  const creditByPhone = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of customersQuery.data ?? []) {
      if (c.credit > 0) map.set(c.phone, c.credit);
    }
    return map;
  }, [customersQuery.data]);

  const rows = useMemo(() => {
    const all = listQuery.data ?? [];
    if (filter === "credit") {
      return all.filter(
        (d) => creditByPhone.has(d.customerPhone) || d.amountPaid > d.amount,
      );
    }
    return all;
  }, [listQuery.data, filter, creditByPhone]);

  const outstanding = (listQuery.data ?? [])
    .filter((d) => d.status === "open" || d.status === "partial")
    .reduce((s, d) => s + Math.max(0, d.amount - d.amountPaid), 0);
  const totalCredit = (customersQuery.data ?? []).reduce(
    (s, c) => s + c.credit,
    0,
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="micro-label">Debt book</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Debts
            </h1>
          </div>
          <div className="flex gap-2">
            <div className="rounded-md border border-border bg-card px-3.5 py-1.5 text-right">
              <p className="micro-label">Owed to shop</p>
              <p className="font-figures font-semibold text-warning">
                {formatKes(outstanding)}
              </p>
            </div>
            <div className="rounded-md border border-border bg-card px-3.5 py-1.5 text-right">
              <p className="micro-label">Store credit out</p>
              <p className="font-figures font-semibold text-success">
                {formatKes(totalCredit)}
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <div className="relative flex-1 min-w-40 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or phone…"
              className="pl-9 bg-card border-input h-9 text-sm"
            />
          </div>
          <div className="flex gap-1.5">
            {(
              [
                ["pending", "Pending"],
                ["closed", "Closed"],
                ["credit", "Credit"],
                ["all", "All"],
              ] as [Filter, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  filter === value
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {listQuery.isLoading ? (
          <p className="text-sm text-muted-foreground py-6">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
            <Wallet className="size-6 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm">
              {filter === "credit"
                ? "No customers hold store credit right now."
                : filter === "closed"
                  ? "No settled debts yet."
                  : "No debts here. Debt sales from checkout appear here."}
            </p>
          </div>
        ) : (
          <ul className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
            {rows.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className="w-full text-left px-4 py-3 hover:bg-secondary/60 transition-colors cursor-pointer flex items-center gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {d.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {d.customerPhone} ·{" "}
                      {new Date(d.createdAt).toLocaleDateString("en-KE")}
                    </p>
                  </div>
                  <DebtStatusBadge status={d.status} />
                  <DebtBalance debt={d} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DebtDetailDialog
        debtId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          listQuery.refetch();
          customersQuery.refetch();
        }}
        onReceipt={onReceipt}
      />
    </div>
  );
}
