import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/providers/trpc";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { debtStatusLabel } from "@/lib/labels";
import { ArrowLeft, Search, Wallet, Loader2 } from "lucide-react";

// Cashier debt book: who owes what, what they took, and repayments.

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReceipt: (saleId: number) => void;
};

export function DebtsSheet({ open, onOpenChange, onReceipt }: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listQuery = trpc.debts.list.useQuery(
    { activeOnly: true, search: search || undefined },
    { enabled: open },
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSelectedId(null);
      }}
    >
      <SheetContent className="bg-card border-border w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display flex items-center gap-2">
            <Wallet className="size-4 text-primary" />
            Debts
          </SheetTitle>
        </SheetHeader>
        {selectedId === null ? (
          <DebtList
            search={search}
            onSearch={setSearch}
            query={listQuery}
            onSelect={setSelectedId}
          />
        ) : (
          <DebtDetail
            debtId={selectedId}
            onBack={() => setSelectedId(null)}
            onChanged={() => listQuery.refetch()}
            onReceipt={onReceipt}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DebtList({
  search,
  onSearch,
  query,
  onSelect,
}: {
  search: string;
  onSearch: (v: string) => void;
  query: ReturnType<typeof trpc.debts.list.useQuery>;
  onSelect: (id: number) => void;
}) {
  const rows = query.data ?? [];
  return (
    <div className="mt-3 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="pl-9 bg-background border-input h-9 text-sm"
        />
      </div>
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground py-4">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No unpaid debts. Debt sales from checkout appear here.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border overflow-hidden">
          {rows.map((d) => {
            const balance = d.amount - d.amountPaid;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.id)}
                  className="w-full text-left px-3 py-2.5 hover:bg-secondary/60 transition-colors cursor-pointer flex items-center gap-3"
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
                  <span className="font-figures text-sm font-semibold text-warning">
                    {formatKes(balance)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DebtDetail({
  debtId,
  onBack,
  onChanged,
  onReceipt,
}: {
  debtId: number;
  onBack: () => void;
  onChanged: () => void;
  onReceipt: (saleId: number) => void;
}) {
  const detailQuery = trpc.debts.get.useQuery({ id: debtId });
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
  if (detailQuery.isLoading || !data) {
    return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  }
  const { debt, payments, items, receiptNo } = data;
  const balance = debt.amount - debt.amountPaid;
  const amount = parseKes(amountText);
  const closed = debt.status === "settled" || debt.status === "cancelled";

  return (
    <div className="mt-3 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft className="size-4" />
        All debts
      </button>

      <div className="rounded-md border border-border bg-secondary/50 p-3.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-display font-semibold">{debt.customerName}</p>
          <DebtStatusBadge status={debt.status} />
        </div>
        <p className="text-sm text-muted-foreground">{debt.customerPhone}</p>
        <div className="grid grid-cols-3 gap-2 pt-1 text-center">
          <div>
            <p className="micro-label">Taken</p>
            <p className="font-figures font-semibold">{formatKes(debt.amount)}</p>
          </div>
          <div>
            <p className="micro-label">Paid</p>
            <p className="font-figures font-semibold text-success">
              {formatKes(debt.amountPaid)}
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

      {items.length > 0 && (
        <div>
          <p className="micro-label mb-1.5">
            Items taken{receiptNo ? ` · ${receiptNo}` : ""}
          </p>
          <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
            {items.map((item) => (
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
          {debt.saleId && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1.5 text-muted-foreground"
              onClick={() => onReceipt(debt.saleId!)}
            >
              View receipt
            </Button>
          )}
        </div>
      )}

      {!closed && (
        <div className="space-y-2.5 rounded-md border border-border p-3.5">
          <Label htmlFor="debt-pay">Record a payment (KES)</Label>
          <div className="flex gap-2">
            <Input
              id="debt-pay"
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
                record.mutate({ debtId: debt.id, amount: amount ?? 0, method: "cash" })
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
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {payments.map((p) => (
              <li
                key={p.id}
                className="py-2 flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-muted-foreground">
                  {new Date(p.createdAt).toLocaleString("en-KE")} ·{" "}
                  {p.method === "megapay" ? "M-Pesa" : "Cash"} · {p.cashierName}
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
  );
}

export function DebtStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "border-warning/60 text-warning",
    partial: "border-primary/50 text-primary",
    settled: "border-success/60 text-success",
    cancelled: "border-muted-foreground/40 text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] uppercase tracking-wide ${styles[status] ?? ""}`}
    >
      {debtStatusLabel(status)}
    </Badge>
  );
}
