import { useEffect, useState } from "react";
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
import { trpc } from "@/providers/trpc";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, parseKes } from "@/lib/money";
import type { CartTab, PendingPayment } from "./types";
import { cartTotal } from "./types";
import {
  Banknote,
  Smartphone,
  Loader2,
  CheckCircle2,
  XCircle,
  Split,
  BookUser,
  BadgePercent,
} from "lucide-react";

export type CompletedSale = {
  saleId: number;
  receiptNo: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: CartTab;
  megapayEnabled: boolean;
  onCompleted: (result: CompletedSale) => void;
  /** M-Pesa STK push sent — the cart keeps waiting in the background. */
  onPending: (pending: PendingPayment) => void;
};

type Phase =
  | { step: "choose" }
  | { step: "cash" }
  | { step: "mpesa" }
  | { step: "split" }
  | { step: "bargain" }
  | { step: "debt" }
  | { step: "error"; message: string };

export function CheckoutDialog({
  open,
  onOpenChange,
  tab,
  megapayEnabled,
  onCompleted,
  onPending,
}: Props) {
  const { total } = cartTotal(tab);
  const [phase, setPhase] = useState<Phase>({ step: "choose" });
  const [tenderedText, setTenderedText] = useState("");
  const [phone, setPhone] = useState("");
  const [cashPartText, setCashPartText] = useState("");
  const [splitRemainder, setSplitRemainder] = useState<"megapay" | "debt">(
    "megapay",
  );
  // Debt customers are registered by the admin — the cashier only picks from
  // the list, never types a new one.
  const [debtCustomer, setDebtCustomer] = useState<{
    name: string;
    phone: string;
  } | null>(null);
  const [bargainText, setBargainText] = useState("");
  const [busy, setBusy] = useState(false);

  const checkout = trpc.sales.checkout.useMutation();
  const utils = trpc.useUtils();
  // Registered debt customers for this shop — the cashier can only sell on
  // debt to someone the admin has added.
  const customersQuery = trpc.debts.customers.useQuery(undefined, {
    enabled:
      open && (phase.step === "debt" || phase.step === "split"),
  });

  useEffect(() => {
    if (open) {
      setPhase({ step: "choose" });
      setTenderedText("");
      setPhone("");
      setCashPartText("");
      setSplitRemainder(megapayEnabled ? "megapay" : "debt");
      setDebtCustomer(null);
      setBargainText("");
      setBusy(false);
    }
  }, [open, megapayEnabled]);

  const linesPayload = () =>
    tab.lines.map((l) => ({
      productId: l.productId,
      qty: l.qty,
      ...(l.pack ? { packId: l.pack.id } : {}),
      ...(l.pack ? {} : { unitPrice: l.unitPrice }),
    }));

  async function runCheckout(
    input: Parameters<typeof checkout.mutateAsync>[0],
  ): Promise<void> {
    setBusy(true);
    try {
      const result = await checkout.mutateAsync(input);
      await utils.products.listForShop.invalidate();
      if (result.sale.status === "pending") {
        // M-Pesa prompt is on the customer's phone — free up the till and let
        // the cart wait in the background while the cashier serves others.
        onPending({
          saleId: result.sale.id,
          receiptNo: result.sale.receiptNo,
          method: input.paymentMethod === "split" ? "split" : "megapay",
          total: result.sale.total,
          phone: input.customerPhone ?? "",
        });
      } else {
        onCompleted({
          saleId: result.sale.id,
          receiptNo: result.sale.receiptNo,
        });
      }
    } catch (err) {
      setPhase({ step: "error", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  // Bargain flow: the cashier enters the agreed amount at checkout; it is
  // applied as a discount off the list total. All payment steps then work
  // with the agreed (effective) total.
  const subtotalAll = total + tab.discount;
  const agreed = parseKes(bargainText);
  const bargainValid = agreed !== null && agreed > 0 && agreed <= subtotalAll;
  const bargainDiscount = bargainValid ? subtotalAll - agreed : null;
  const effectiveDiscount = bargainDiscount ?? tab.discount;
  const effectiveTotal = subtotalAll - effectiveDiscount;
  function goChoose() {
    setBargainText("");
    setPhase({ step: "choose" });
  }

  const tendered = parseKes(tenderedText);
  const change = tendered !== null ? tendered - effectiveTotal : null;

  const cashPart = parseKes(cashPartText);
  const splitMpesa = cashPart !== null ? effectiveTotal - cashPart : null;
  const splitTendered = parseKes(tenderedText);
  const splitChange =
    splitTendered !== null && cashPart !== null
      ? splitTendered - cashPart
      : null;

  const phoneValid = phone.replace(/\D/g, "").length >= 9;

  const mpesaNote = megapayEnabled
    ? "Send STK push to the customer's phone"
    : "Set MEGAPAY_API_KEY on the server first";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border w-[calc(100vw-1.5rem)] sm:max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="font-display">Checkout — {tab.label}</DialogTitle>
          <DialogDescription className="sr-only">
            Take payment for the current sale
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-secondary/60 px-4 py-3 flex items-baseline justify-between gap-3">
          <span className="micro-label shrink-0">Total due</span>
          <span className="font-figures text-2xl font-semibold truncate">
            {formatKes(effectiveTotal)}
          </span>
        </div>
        {bargainDiscount !== null && (
          <p className="text-xs text-warning -mt-1">
            Bargain — list price {formatKes(subtotalAll)}, discount{" "}
            {formatKes(bargainDiscount)} applied
          </p>
        )}

        {phase.step === "choose" && (
          <div className="grid gap-2.5 min-w-0">
            <Button
              variant="outline"
              className="h-auto min-h-13 w-full min-w-0 justify-start gap-3 border-border hover:bg-secondary py-2.5"
              onClick={() => setPhase({ step: "cash" })}
            >
              <Banknote className="size-5 text-primary shrink-0" />
              <span className="text-left min-w-0">
                <span className="block font-semibold">Cash</span>
                <span className="block text-xs text-muted-foreground whitespace-normal break-words">
                  Take money, give change
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-13 w-full min-w-0 justify-start gap-3 border-border hover:bg-secondary py-2.5"
              onClick={() => setPhase({ step: "mpesa" })}
              disabled={!megapayEnabled}
              title={mpesaNote}
            >
              <Smartphone className="size-5 text-primary shrink-0" />
              <span className="text-left min-w-0">
                <span className="block font-semibold">M-Pesa</span>
                <span className="block text-xs text-muted-foreground whitespace-normal break-words">
                  {mpesaNote} — you can serve other carts while you wait
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-13 w-full min-w-0 justify-start gap-3 border-border hover:bg-secondary py-2.5"
              onClick={() => setPhase({ step: "split" })}
            >
              <Split className="size-5 text-primary shrink-0" />
              <span className="text-left min-w-0">
                <span className="block font-semibold">Split · Cash + M-Pesa/Debt</span>
                <span className="block text-xs text-muted-foreground whitespace-normal break-words">
                  Part cash now, the rest by M-Pesa prompt or on the customer's tab
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-13 w-full min-w-0 justify-start gap-3 border-border hover:bg-secondary py-2.5"
              onClick={() => setPhase({ step: "debt" })}
            >
              <BookUser className="size-5 text-primary shrink-0" />
              <span className="text-left min-w-0">
                <span className="block font-semibold">Debt · Pay later</span>
                <span className="block text-xs text-muted-foreground whitespace-normal break-words">
                  Only for customers the admin has registered — collect later
                </span>
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-auto min-h-13 w-full min-w-0 justify-start gap-3 border-border hover:bg-secondary py-2.5"
              onClick={() => setPhase({ step: "bargain" })}
            >
              <BadgePercent className="size-5 text-primary shrink-0" />
              <span className="text-left min-w-0">
                <span className="block font-semibold">Bargain · Agreed price</span>
                <span className="block text-xs text-muted-foreground whitespace-normal break-words">
                  Enter the final amount you agreed with the customer
                </span>
              </span>
            </Button>
          </div>
        )}

        {phase.step === "bargain" && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-secondary/60 px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">List total</span>
              <span className="font-figures font-semibold">
                {formatKes(subtotalAll)}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agreed">Agreed amount (KES)</Label>
              <Input
                id="agreed"
                inputMode="decimal"
                autoFocus
                placeholder={formatPlain(subtotalAll)}
                value={bargainText}
                onChange={(e) => setBargainText(e.target.value)}
                className="bg-background border-input h-12 font-figures text-lg"
              />
              <p className="text-xs text-muted-foreground">
                {bargainValid
                  ? (bargainDiscount ?? 0) > 0
                    ? `Discount of ${formatKes(bargainDiscount ?? 0)} — customer pays ${formatKes(agreed ?? 0)}`
                    : "Full price — no discount"
                  : "Enter the final amount you agreed with the customer"}
              </p>
            </div>
            <div className="space-y-2">
              <p className="micro-label">Pay the agreed amount with</p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  variant="outline"
                  className="border-border hover:bg-secondary gap-1.5"
                  disabled={!bargainValid}
                  onClick={() => setPhase({ step: "cash" })}
                >
                  <Banknote className="size-4 text-primary" />
                  Cash
                </Button>
                <Button
                  variant="outline"
                  className="border-border hover:bg-secondary gap-1.5"
                  disabled={!bargainValid || !megapayEnabled}
                  onClick={() => setPhase({ step: "mpesa" })}
                >
                  <Smartphone className="size-4 text-primary" />
                  M-Pesa
                </Button>
                <Button
                  variant="outline"
                  className="border-border hover:bg-secondary gap-1.5"
                  disabled={!bargainValid}
                  onClick={() => setPhase({ step: "split" })}
                >
                  <Split className="size-4 text-primary" />
                  Split
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={goChoose}
            >
              Back
            </Button>
          </div>
        )}

        {phase.step === "cash" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="tendered">Cash received</Label>
              <Input
                id="tendered"
                inputMode="decimal"
                autoFocus
                placeholder={formatPlain(effectiveTotal)}
                value={tenderedText}
                onChange={(e) => setTenderedText(e.target.value)}
                className="bg-background border-input h-12 font-figures text-lg"
              />
            </div>
            <div className="rounded-md border border-border bg-secondary/60 px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Change to give
              </span>
              <span
                className={`font-figures text-xl font-semibold ${
                  change !== null && change < 0 ? "text-destructive" : "text-success"
                }`}
              >
                {change === null ? "—" : formatKes(Math.max(0, change))}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border"
                onClick={goChoose}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={busy || (tendered !== null && tendered < effectiveTotal)}
                onClick={() =>
                  runCheckout({
                    paymentMethod: "cash",
                    lines: linesPayload(),
                    discount: effectiveDiscount,
                    tendered: tendered ?? effectiveTotal,
                  })
                }
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Complete sale"}
              </Button>
            </div>
          </div>
        )}

        {phase.step === "mpesa" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mpesa-phone">Customer M-Pesa number</Label>
              <Input
                id="mpesa-phone"
                inputMode="tel"
                autoFocus
                placeholder="0712 345 678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-background border-input h-12 font-figures text-lg"
              />
              <p className="text-xs text-muted-foreground">
                The customer gets an M-Pesa prompt for {formatKes(effectiveTotal)}. The
                cart waits in the background — you can keep selling.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border"
                onClick={goChoose}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={busy || !phoneValid}
                onClick={() =>
                  runCheckout({
                    paymentMethod: "megapay",
                    lines: linesPayload(),
                    discount: effectiveDiscount,
                    customerPhone: phone,
                  })
                }
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send M-Pesa prompt"
                )}
              </Button>
            </div>
          </div>
        )}

        {phase.step === "split" && (
          <div className="space-y-3.5">
            {/* How the remainder (total − cash part) is settled */}
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-1">
              <button
                type="button"
                disabled={!megapayEnabled}
                onClick={() => setSplitRemainder("megapay")}
                className={`rounded px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  splitRemainder === "megapay"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Rest by M-Pesa
              </button>
              <button
                type="button"
                onClick={() => setSplitRemainder("debt")}
                className={`rounded px-2 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors cursor-pointer ${
                  splitRemainder === "debt"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Rest on debt
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cash-part">Cash part (KES)</Label>
                <Input
                  id="cash-part"
                  inputMode="decimal"
                  autoFocus
                  placeholder={formatPlain(Math.floor(effectiveTotal / 2))}
                  value={cashPartText}
                  onChange={(e) => setCashPartText(e.target.value)}
                  className="bg-background border-input h-11 font-figures"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {splitRemainder === "megapay" ? "M-Pesa part" : "Debt part"}
                </Label>
                <div className="h-11 rounded-md border border-border bg-secondary/60 px-3 flex items-center font-figures font-semibold">
                  {splitMpesa !== null && splitMpesa > 0
                    ? formatKes(splitMpesa)
                    : "—"}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="split-tendered">Cash received</Label>
                <Input
                  id="split-tendered"
                  inputMode="decimal"
                  placeholder={cashPart !== null ? formatPlain(cashPart) : "0"}
                  value={tenderedText}
                  onChange={(e) => setTenderedText(e.target.value)}
                  className="bg-background border-input h-11 font-figures"
                />
              </div>
              <div className="space-y-2">
                <Label>Change to give</Label>
                <div
                  className={`h-11 rounded-md border border-border bg-secondary/60 px-3 flex items-center font-figures font-semibold ${
                    splitChange !== null && splitChange < 0
                      ? "text-destructive"
                      : "text-success"
                  }`}
                >
                  {splitChange === null ? "—" : formatKes(Math.max(0, splitChange))}
                </div>
              </div>
            </div>
            {splitRemainder === "megapay" ? (
              <div className="space-y-2">
                <Label htmlFor="split-phone">Customer M-Pesa number</Label>
                <Input
                  id="split-phone"
                  inputMode="tel"
                  placeholder="0712 345 678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="bg-background border-input h-11 font-figures"
                />
              </div>
            ) : (
              <DebtCustomerPicker
                customers={customersQuery.data ?? []}
                loading={customersQuery.isLoading}
                selected={debtCustomer}
                onSelect={setDebtCustomer}
              />
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border"
                onClick={goChoose}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={
                  busy ||
                  cashPart === null ||
                  cashPart <= 0 ||
                  cashPart >= effectiveTotal ||
                  (splitTendered !== null && splitTendered < cashPart) ||
                  (splitRemainder === "megapay"
                    ? !phoneValid
                    : debtCustomer === null)
                }
                onClick={() =>
                  runCheckout({
                    paymentMethod: "split",
                    lines: linesPayload(),
                    discount: effectiveDiscount,
                    cashAmount: cashPart ?? 0,
                    tendered: splitTendered ?? cashPart ?? 0,
                    remainder: splitRemainder,
                    customerPhone:
                      splitRemainder === "megapay" ? phone : debtCustomer!.phone,
                    customerName:
                      splitRemainder === "debt" ? debtCustomer!.name : undefined,
                  })
                }
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : splitRemainder === "megapay" ? (
                  "Take cash + send prompt"
                ) : (
                  "Take cash + record debt"
                )}
              </Button>
            </div>
          </div>
        )}

        {phase.step === "debt" && (
          <div className="space-y-4">
            <DebtCustomerPicker
              customers={customersQuery.data ?? []}
              loading={customersQuery.isLoading}
              selected={debtCustomer}
              onSelect={setDebtCustomer}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border"
                onClick={goChoose}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={busy || debtCustomer === null}
                onClick={() =>
                  runCheckout({
                    paymentMethod: "debt",
                    lines: linesPayload(),
                    discount: effectiveDiscount,
                    customerName: debtCustomer!.name,
                    customerPhone: debtCustomer!.phone,
                  })
                }
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  `Record debt · ${formatKes(effectiveTotal)}`
                )}
              </Button>
            </div>
          </div>
        )}

        {phase.step === "error" && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <XCircle className="size-8 text-destructive" />
            <p className="text-sm">{phase.message}</p>
            <Button
              variant="outline"
              className="border-border"
              onClick={() => setPhase({ step: "choose" })}
            >
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type DebtCustomer = { name: string; phone: string };

/** Pick-from-list only: debt customers are registered by the admin. */
function DebtCustomerPicker({
  customers,
  loading,
  selected,
  onSelect,
}: {
  customers: { name: string; phone: string; owes: number; credit: number }[];
  loading: boolean;
  selected: DebtCustomer | null;
  onSelect: (c: DebtCustomer) => void;
}) {
  if (loading) {
    return (
      <p className="text-sm text-muted-foreground py-3 text-center">
        Loading debt customers…
      </p>
    );
  }
  if (customers.length === 0) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
        No debt customers registered for this shop yet — ask the admin to add
        the customer from the Debts page first.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="micro-label">Debt customer — registered by the admin</p>
      <div className="max-h-36 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {customers.map((c) => {
          const isSelected = selected?.phone === c.phone;
          return (
            <button
              key={c.phone}
              type="button"
              onClick={() => onSelect({ name: c.name, phone: c.phone })}
              className={`w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-sm transition-colors cursor-pointer ${
                isSelected ? "bg-primary/10" : "hover:bg-secondary"
              }`}
            >
              <span className="min-w-0">
                <span className="block font-medium truncate">{c.name}</span>
                <span className="block text-xs text-muted-foreground font-figures">
                  {c.phone}
                </span>
              </span>
              <span className="shrink-0 text-xs font-figures text-right">
                {c.owes > 0 && (
                  <span className="block text-warning">owes {formatKes(c.owes)}</span>
                )}
                {c.credit > 0 && (
                  <span className="block text-success">
                    credit {formatKes(c.credit)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {selected && (
        <p className="text-xs text-success">
          {selected.name} selected — this sale goes onto their tab.
        </p>
      )}
    </div>
  );
}

export function SaleSuccessBadge({ sale }: { sale: CompletedSale }) {
  return (
    <div className="flex items-center gap-2 text-primary">
      <CheckCircle2 className="size-4" />
      <span className="text-sm font-medium">Sale {sale.receiptNo} completed</span>
    </div>
  );
}
