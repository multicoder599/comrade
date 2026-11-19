import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/providers/trpc";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { debtStatusLabel } from "@/lib/labels";
import { Loader2, Wallet } from "lucide-react";

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

/** Balance display: red-ish when owed, green credit when overpaid. */
export function DebtBalance({ debt }: { debt: { amount: number; amountPaid: number } }) {
  const balance = debt.amount - debt.amountPaid;
  if (balance < 0) {
    return (
      <span className="font-figures text-sm font-semibold text-success">
        Credit {formatKes(-balance)}
      </span>
    );
  }
  return (
    <span
      className={`font-figures text-sm font-semibold ${balance > 0 ? "text-warning" : "text-muted-foreground"}`}
    >
      {formatKes(balance)}
    </span>
  );
}

export function DebtDetailDialog({
  debtId,
  onClose,
  onChanged,
  onReceipt,
}: {
  debtId: number | null;
  onClose: () => void;
  onChanged: () => void;
  onReceipt?: (saleId: number) => void;
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
  const overpayBy =
    amount !== null && balance > 0 ? Math.max(0, amount - balance) : 0;
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
                  {data.debt.customerPhone} · Shop {data.debt.shop} · since{" "}
                  {new Date(data.debt.createdAt).toLocaleDateString("en-KE")}
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
                  <p className="micro-label">
                    {balance < 0 ? "Credit" : "Balance"}
                  </p>
                  <p
                    className={`font-figures font-semibold ${balance < 0 ? "text-success" : "text-warning"}`}
                  >
                    {formatKes(Math.abs(balance))}
                  </p>
                </div>
              </div>
              {data.credit > 0 && (
                <p className="text-xs text-success pt-1">
                  {data.debt.customerName.split(" ")[0]} has{" "}
                  {formatKes(data.credit)} store credit — applied automatically
                  to their next debt purchase.
                </p>
              )}
            </div>

            {data.items.length > 0 && (
              <div>
                <p className="micro-label mb-1.5">
                  Items taken
                  {data.linkedSales.length > 0
                    ? ` · ${data.linkedSales.map((s) => s.receiptNo).join(", ")}`
                    : ""}
                </p>
                <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
                  {data.items.map((item) => {
                    const packs =
                      item.packName && item.packUnits && item.packUnits > 0
                        ? item.qty / item.packUnits
                        : null;
                    return (
                      <li
                        key={item.id}
                        className="px-3 py-2 flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">
                          {item.name}
                          <span className="text-muted-foreground">
                            {" "}
                            ×{formatQty(packs ?? item.qty)}
                            {item.packName ? ` ${item.packName}` : ""} @{" "}
                            {formatPlain(
                              packs !== null && packs > 0
                                ? Math.round(item.lineTotal / packs)
                                : item.unitPrice,
                            )}
                          </span>
                        </span>
                        <span className="font-figures shrink-0">
                          {formatKes(item.lineTotal)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {onReceipt && data.linkedSales.length > 0 && (
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {data.linkedSales.map((s) => (
                      <Button
                        key={s.id}
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground h-7 text-xs"
                        onClick={() => onReceipt(s.id)}
                      >
                        Receipt {s.receiptNo}
                      </Button>
                    ))}
                  </div>
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
                    placeholder={formatPlain(Math.max(0, balance))}
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
                {overpayBy > 0 && (
                  <p className="text-xs text-success">
                    Pays off the debt — the extra {formatKes(overpayBy)} becomes
                    store credit for next time.
                  </p>
                )}
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
                        {p.method === "megapay"
                          ? "M-Pesa"
                          : p.method === "credit"
                            ? "Store credit applied"
                            : "Cash"}{" "}
                        · {p.cashierName}
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
