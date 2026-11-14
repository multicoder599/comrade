import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { DebtStatusBadge } from "@/components/pos/DebtsSheet";
import { Search, Loader2, Wallet } from "lucide-react";

type StatusFilter = "active" | "open" | "partial" | "settled" | "all";

export default function Debts() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [selectedId, setSelectedId] = useState<number | null>(null);

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
                <TableCell className="text-right font-figures font-semibold text-warning">
                  {formatKes(d.amount - d.amountPaid)}
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
      />
    </div>
  );
}

function DebtDetailDialog({
  debtId,
  onClose,
  onChanged,
}: {
  debtId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detailQuery = trpc.debts.get.useQuery(
    { id: debtId ?? 0 },
    { enabled: debtId !== null },
  );
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const record = trpc.debts.recordPayment.useMutation({
    onSuccess: () => {
      setAmountText("");
      setError(null);
      detailQuery.refetch();
      onChanged();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  const data = detailQuery.data;
  const balance = data ? data.debt.amount - data.debt.amountPaid : 0;
  const amount = parseKes(amountText);
  const closed =
    data?.debt.status === "settled" || data?.debt.status === "cancelled";

  return (
    <Dialog
      open={debtId !== null}
      onOpenChange={(o) => {
        if (!o) {
          setAmountText("");
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="bg-card border-border sm:max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Wallet className="size-4 text-primary" />
            {data ? data.debt.customerName : "Debt"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Debt details and payments
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <p className="text-sm text-muted-foreground py-4">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-secondary/50 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {data.debt.customerPhone} · Shop {data.debt.shop} ·{" "}
                  {new Date(data.debt.createdAt).toLocaleString("en-KE")}
                </p>
                <DebtStatusBadge status={data.debt.status} />
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                <div>
                  <p className="micro-label">Taken</p>
                  <p className="font-figures font-semibold">
                    {formatKes(data.debt.amount)}
                  </p>
                </div>
                <div>
                  <p className="micro-label">Paid</p>
                  <p className="font-figures font-semibold text-success">
                    {formatKes(data.debt.amountPaid)}
                  </p>
                </div>
                <div>
                  <p className="micro-label">Balance</p>
                  <p className="font-figures font-semibold text-warning">
                    {formatKes(balance)}
                  </p>
                </div>
              </div>
            </div>

            {data.items.length > 0 && (
              <div>
                <p className="micro-label mb-1.5">
                  Items taken
                  {data.receiptNo ? ` · ${data.receiptNo}` : ""}
                </p>
                <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
                  {data.items.map((item) => (
                    <li
                      key={item.id}
                      className="px-3 py-2 flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="truncate">
                        {item.name}
                        <span className="text-muted-foreground">
                          {" "}
                          ×{formatQty(item.qty)} @ {formatPlain(item.unitPrice)}
                        </span>
                        {item.priceType === "wholesale" && (
                          <span className="text-warning text-[10px] font-semibold uppercase">
                            {" "}
                            W
                          </span>
                        )}
                      </span>
                      <span className="font-figures shrink-0">
                        {formatKes(item.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!closed && (
              <div className="space-y-2.5 rounded-md border border-border p-3.5">
                <Label htmlFor="admin-debt-pay">Record a payment (KES)</Label>
                <div className="flex gap-2">
                  <Input
                    id="admin-debt-pay"
                    inputMode="decimal"
                    placeholder={formatPlain(balance)}
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    className="bg-background border-input font-figures h-10"
                  />
                  <Button
                    className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
                    disabled={record.isPending || amount === null || amount <= 0}
                    onClick={() =>
                      record.mutate({
                        debtId: data.debt.id,
                        amount: amount ?? 0,
                        method: "cash",
                      })
                    }
                  >
                    {record.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      "Add payment"
                    )}
                  </Button>
                </div>
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="micro-label mb-1.5">Payment history</p>
              {data.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.payments.map((p) => (
                    <li
                      key={p.id}
                      className="py-2 flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="text-muted-foreground">
                        {new Date(p.createdAt).toLocaleString("en-KE")} ·{" "}
                        {p.method === "megapay" ? "M-Pesa" : "Cash"} ·{" "}
                        {p.cashierName}
                      </span>
                      <span className="font-figures font-semibold text-success">
                        {formatKes(p.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
