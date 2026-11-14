import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { formatKes } from "@/lib/money";
import {
  DebtDetailDialog,
  DebtStatusBadge,
  DebtBalance,
} from "@/components/pos/DebtDetailDialog";
import { ReceiptDialog } from "@/components/pos/ReceiptDialog";
import { Search } from "lucide-react";

type StatusFilter = "active" | "open" | "partial" | "settled" | "all";

export default function Debts() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<number | null>(null);

  const listQuery = trpc.debts.list.useQuery(
    {
      search: search || undefined,
      activeOnly: filter === "active",
      status:
        filter === "open" || filter === "partial" || filter === "settled"
          ? filter
          : undefined,
    },
    { placeholderData: (prev) => prev },
  );
  const summaryQuery = trpc.debts.summary.useQuery();
  const settingsQuery = trpc.settings.get.useQuery(undefined, { retry: false });

  const rows = listQuery.data ?? [];
  const totalOutstanding = (summaryQuery.data ?? []).reduce(
    (s, r) => s + r.outstanding,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="micro-label">Credit book</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Debts
          </h1>
        </div>
        <div className="rounded-md border border-border bg-card px-4 py-2 text-right">
          <p className="micro-label">Total outstanding</p>
          <p className="font-figures text-xl font-semibold text-warning">
            {formatKes(totalOutstanding)}
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer name or phone…"
            className="pl-9 bg-card border-input"
          />
        </div>
        <div className="flex gap-1.5">
          {(
            [
              ["active", "Unpaid"],
              ["open", "Open"],
              ["partial", "Part paid"],
              ["settled", "Settled"],
              ["all", "All"],
            ] as [StatusFilter, string][]
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

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Customer</TableHead>
              <TableHead className="text-center">Shop</TableHead>
              <TableHead className="text-right">Taken</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead>Since</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow
                key={d.id}
                className="border-border cursor-pointer"
                onClick={() => setSelectedId(d.id)}
              >
                <TableCell>
                  <p className="font-medium">{d.customerName}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.customerPhone}
                  </p>
                </TableCell>
                <TableCell className="text-center">{d.shop}</TableCell>
                <TableCell className="text-right font-figures">
                  {formatKes(d.amount)}
                </TableCell>
                <TableCell className="text-right font-figures text-success">
                  {formatKes(d.amountPaid)}
                </TableCell>
                <TableCell className="text-right">
                  <DebtBalance debt={d} />
                </TableCell>
                <TableCell className="text-center">
                  <DebtStatusBadge status={d.status} />
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(d.createdAt).toLocaleDateString("en-KE")}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="border-border">
                <TableCell
                  colSpan={7}
                  className="py-8 text-center text-muted-foreground"
                >
                  {listQuery.isLoading ? "Loading…" : "No debts found."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DebtDetailDialog
        debtId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          listQuery.refetch();
          summaryQuery.refetch();
        }}
        onReceipt={(id) => setReceiptSaleId(id)}
      />
      <ReceiptDialog
        saleId={receiptSaleId}
        open={receiptSaleId !== null}
        onOpenChange={(open) => !open && setReceiptSaleId(null)}
        businessName={settingsQuery.data?.businessName ?? "Comrade Shop"}
      />
    </div>
  );
}
