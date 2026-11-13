import { useEffect, useRef, useState } from "react";
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
import type { CartTab } from "./types";
import { cartTotal } from "./types";
import { Banknote, Smartphone, Loader2, CheckCircle2, XCircle } from "lucide-react";

export type CompletedSale = {
  saleId: number;
  receiptNo: string;
  total: number;
  tendered: number | null;
  change: number | null;
  paymentMethod: "cash" | "megapay";
  mpesaReceipt: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: CartTab;
  shop: "A" | "B";
  megapayEnabled: boolean;
  onCompleted: (result: CompletedSale) => void;
};

type Phase =
  | { step: "choose" }
  | { step: "cash" }
  | { step: "mpesa-phone" }
  | { step: "mpesa-waiting"; saleId: number; message: string }
  | { step: "error"; message: string };

export function CheckoutDialog({
  open,
  onOpenChange,
  tab,
  shop,
  megapayEnabled,
  onCompleted,
}: Props) {
  const { total } = cartTotal(tab);
  const [phase, setPhase] = useState<Phase>({ step: "choose" });
  const [tenderedText, setTenderedText] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkout = trpc.sales.checkout.useMutation();
  const refreshPayment = trpc.sales.refreshPayment.useMutation();
  const utils = trpc.useUtils();

  useEffect(() => {
    if (open) {
      setPhase({ step: "choose" });
      setTenderedText("");
      setPhone("");
      setBusy(false);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [open]);

  async function payCash() {
    const tendered = parseKes(tenderedText) ?? total;
    setBusy(true);
    try {
      const result = await checkout.mutateAsync({
        mode: tab.mode,
        paymentMethod: "cash",
        lines: tab.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        discount: tab.discount,
        tendered,
        customerName: tab.customerName || undefined,
      });
      await utils.products.listForShop.invalidate();
      onCompleted({
        saleId: result.sale.id,
        receiptNo: result.sale.receiptNo,
        total: result.sale.total,
        tendered: result.sale.tendered,
        change: result.sale.change,
        paymentMethod: "cash",
        mpesaReceipt: null,
      });
    } catch (err) {
      setPhase({ step: "error", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function payMpesa() {
    setBusy(true);
    try {
      const result = await checkout.mutateAsync({
        mode: tab.mode,
        paymentMethod: "megapay",
        lines: tab.lines.map((l) => ({
          productId: l.productId,
          qty: l.qty,
          unitPrice: l.unitPrice,
        })),
        discount: tab.discount,
        customerName: tab.customerName || undefined,
        customerPhone: phone,
      });
      const saleId = result.sale.id;
      setPhase({
        step: "mpesa-waiting",
        saleId,
        message: result.stkMessage ?? "STK push sent",
      });
      // Poll MegaPay until the customer accepts or cancels the prompt.
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const sale = await refreshPayment.mutateAsync({ saleId });
          if (sale.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            await utils.products.listForShop.invalidate();
            onCompleted({
              saleId: sale.id,
              receiptNo: sale.receiptNo,
              total: sale.total,
              tendered: null,
              change: null,
              paymentMethod: "megapay",
              mpesaReceipt: sale.mpesaReceipt,
            });
          } else if (sale.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({
              step: "error",
              message: "Payment was cancelled or failed. Stock has been restored.",
            });
          } else if (attempts > 40) {
            if (pollRef.current) clearInterval(pollRef.current);
            setPhase({
              step: "error",
              message:
                "Timed out waiting for the customer. Check Recent Sales to confirm the final status.",
            });
          }
        } catch {
          /* keep polling through transient errors */
        }
      }, 3000);
    } catch (err) {
      setPhase({ step: "error", message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const tendered = parseKes(tenderedText);
  const change = tendered !== null ? tendered - total : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Checkout</DialogTitle>
          <DialogDescription className="sr-only">
            Take payment for the current sale
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-border bg-secondary/60 px-4 py-3 flex items-baseline justify-between">
          <span className="micro-label">Total due</span>
          <span className="font-figures text-2xl font-semibold">
            {formatKes(total)}
          </span>
        </div>

        {phase.step === "choose" && (
          <div className="grid gap-3">
            <Button
              variant="outline"
              className="h-14 justify-start gap-3 border-border hover:bg-secondary"
              onClick={() => setPhase({ step: "cash" })}
            >
              <Banknote className="size-5 text-primary" />
              <span className="text-left">
                <span className="block font-semibold">Cash</span>
                <span className="block text-xs text-muted-foreground">
                  Take money, give change
                </span>
              </span>
            </Button>
            {shop === "A" ? (
              <Button
                variant="outline"
                className="h-14 justify-start gap-3 border-border hover:bg-secondary"
                onClick={() => setPhase({ step: "mpesa-phone" })}
                disabled={!megapayEnabled}
                title={
                  megapayEnabled
                    ? "Send M-Pesa prompt"
                    : "MegaPay is not configured on the server"
                }
              >
                <Smartphone className="size-5 text-primary" />
                <span className="text-left">
                  <span className="block font-semibold">MegaPay · M-Pesa</span>
                  <span className="block text-xs text-muted-foreground">
                    {megapayEnabled
                      ? "Send STK push to the customer's phone"
                      : "Set MEGAPAY_API_KEY on the server first"}
                  </span>
                </span>
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground text-center">
                MegaPay M-Pesa prompts are enabled for Shop A only.
              </p>
            )}
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
                placeholder={formatPlain(total)}
                value={tenderedText}
                onChange={(e) => setTenderedText(e.target.value)}
                className="bg-background border-input h-12 font-figures text-lg"
              />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Change</span>
              <span
                className={`font-figures font-semibold ${
                  change !== null && change < 0 ? "text-destructive" : "text-primary"
                }`}
              >
                {change === null ? "—" : formatKes(Math.max(0, change))}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border"
                onClick={() => setPhase({ step: "choose" })}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={busy || (tendered !== null && tendered < total)}
                onClick={payCash}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : "Complete sale"}
              </Button>
            </div>
          </div>
        )}

        {phase.step === "mpesa-phone" && (
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
                The customer gets an M-Pesa prompt for {formatKes(total)} on this
                phone.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border"
                onClick={() => setPhase({ step: "choose" })}
              >
                Back
              </Button>
              <Button
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                disabled={busy || phone.replace(/\D/g, "").length < 9}
                onClick={payMpesa}
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

        {phase.step === "mpesa-waiting" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="font-medium">Waiting for customer…</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {phase.message} Ask the customer to enter their M-Pesa PIN. This
              updates automatically.
            </p>
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

export function SaleSuccessBadge({ sale }: { sale: CompletedSale }) {
  return (
    <div className="flex items-center gap-2 text-primary">
      <CheckCircle2 className="size-4" />
      <span className="text-sm font-medium">Sale {sale.receiptNo} completed</span>
    </div>
  );
}
