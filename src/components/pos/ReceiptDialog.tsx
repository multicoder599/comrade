import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { formatAmount2, formatQty } from "@/lib/money";
import { Printer } from "lucide-react";

type Props = {
  saleId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName: string;
  /** Optional override — otherwise resolved from the sale's shop via settings. */
  shopName?: string;
};

function receiptDate(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}:${get("second")}`;
}

const DASH = "--------------------------------";

/**
 * Print an exact-fit receipt: clone the receipt into the offscreen print
 * root (76mm wide, so the height measurement matches print), size the page
 * to the content so the printer feeds no blank paper, then print.
 */
function printThermalReceipt() {
  const el = document.getElementById("receipt-print");
  if (!el) {
    window.print();
    return;
  }
  let root = document.getElementById("thermal-print-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "thermal-print-root";
    document.body.appendChild(root);
  }
  root.innerHTML = "";
  const clone = el.cloneNode(true) as HTMLElement;
  clone.removeAttribute("id");
  root.appendChild(clone);
  const heightMm =
    Math.ceil((clone.getBoundingClientRect().height / 96) * 25.4) + 6;
  const style = document.createElement("style");
  style.textContent = `@page { size: 80mm ${heightMm}mm; margin: 0; }`;
  document.head.appendChild(style);
  window.print();
  setTimeout(() => {
    style.remove();
    root.innerHTML = "";
  }, 2000);
}

export function ReceiptDialog({
  saleId,
  open,
  onOpenChange,
  businessName,
  shopName,
}: Props) {
  const query = trpc.sales.get.useQuery(
    { id: saleId ?? 0 },
    { enabled: open && saleId !== null },
  );
  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    enabled: open,
    retry: false,
  });
  const data = query.data;
  const resolvedShopName =
    shopName ??
    (data
      ? data.sale.shop === "A"
        ? settingsQuery.data?.shopAName ?? "Shop A"
        : settingsQuery.data?.shopBName ?? "Shop B"
      : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-card border-border sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display">Receipt</DialogTitle>
          <DialogDescription className="sr-only">
            Printable receipt for the completed sale
          </DialogDescription>
        </DialogHeader>
        {data ? (
          <>
            {/* Thermal-printer layout: white paper, monospace, dashed rules */}
            <div
              id="receipt-print"
              className="rounded-sm bg-white text-neutral-900 px-4 py-3 font-figures text-[12px] leading-snug shadow-inner"
            >
              <div className="text-center uppercase font-bold text-[14px] tracking-wide">
                {businessName}
              </div>
              <div className="text-center uppercase text-[11px]">
                {resolvedShopName}
              </div>
              <Rule />
              <div className="text-center border-y border-neutral-900 py-0.5 my-1 font-bold uppercase tracking-widest">
                Sales Receipt
              </div>
              <div className="space-y-0.5">
                <MetaRow label="RECEIPT" value={data.sale.receiptNo} />
                <MetaRow label="DATE" value={receiptDate(data.sale.createdAt)} />
                <MetaRow label="CASHIER" value={data.sale.cashierName} />
              </div>
              <Rule />
              {/* Column headers */}
              <div className="flex font-bold uppercase">
                <span className="flex-1">Item</span>
                <span className="w-8 text-right">Qty</span>
                <span className="w-14 text-right">Price</span>
                <span className="w-16 text-right">Total</span>
              </div>
              <Rule />
              <div className="space-y-0.5">
                {data.items.map((item) => (
                  <div key={item.id} className="flex uppercase">
                    <span className="flex-1 pr-1 truncate">
                      {item.name}
                      {item.priceType === "wholesale" ? " (W)" : ""}
                    </span>
                    <span className="w-8 text-right">
                      {formatQty(item.qty)}
                    </span>
                    <span className="w-14 text-right">
                      {formatAmount2(item.unitPrice)}
                    </span>
                    <span className="w-16 text-right">
                      {formatAmount2(item.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>
              <Rule />
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span>SUBTOTAL:</span>
                  <span>{formatAmount2(data.sale.subtotal)}</span>
                </div>
                {data.sale.discount > 0 && (
                  <div className="flex justify-between">
                    <span>DISCOUNT:</span>
                    <span>-{formatAmount2(data.sale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-[14px]">
                  <span>TOTAL:</span>
                  <span>KES {formatAmount2(data.sale.total)}</span>
                </div>
              </div>
              <Rule />
              <PaymentLines
                sale={data.sale}
              />
              <Rule />
              <p className="text-center font-bold py-0.5">
                *** Asante! Karibu Tena! ***
              </p>
              <p className="text-center text-[10px] uppercase tracking-wide">
                Powered by {businessName} POS
              </p>
            </div>
            <Button
              variant="outline"
              className="border-border"
              onClick={printThermalReceipt}
            >
              <Printer className="size-4 mr-2" />
              Print receipt
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Loading receipt…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Rule() {
  return (
    <div className="text-center select-none overflow-hidden whitespace-nowrap my-1">
      {DASH}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 font-bold">{label}:</span>
      <span className="truncate">{value}</span>
    </div>
  );
}

function PaymentLines({
  sale,
}: {
  sale: {
    paymentMethod: string;
    total: number;
    cashAmount: number | null;
    mpesaAmount: number | null;
    tendered: number | null;
    change: number | null;
    mpesaReceipt: string | null;
    customerName: string | null;
    customerPhone: string | null;
  };
}) {
  const line = (label: string, value: string, bold = false) => (
    <div
      key={label}
      className={`flex justify-between ${bold ? "font-bold" : ""}`}
    >
      <span>{label}:</span>
      <span className="text-right">{value}</span>
    </div>
  );

  if (sale.paymentMethod === "split") {
    return (
      <div className="space-y-0.5">
        {line("PAYMENT", "CASH + M-PESA", true)}
        {line("CASH", formatAmount2(sale.cashAmount ?? 0))}
        {line("M-PESA", formatAmount2(sale.mpesaAmount ?? 0))}
        {sale.mpesaReceipt && line("M-PESA REF", sale.mpesaReceipt)}
        {sale.tendered !== null &&
          sale.change !== null &&
          sale.change > 0 &&
          line("CHANGE", formatAmount2(sale.change))}
      </div>
    );
  }
  if (sale.paymentMethod === "debt") {
    return (
      <div className="space-y-0.5">
        {line("PAYMENT", "DEBT — PAY LATER", true)}
        {line(
          "CUSTOMER",
          `${sale.customerName ?? ""}${sale.customerPhone ? ` ${sale.customerPhone}` : ""}`,
        )}
      </div>
    );
  }
  if (sale.paymentMethod === "megapay") {
    return (
      <div className="space-y-0.5">
        {line("PAYMENT", "M-PESA", true)}
        {sale.mpesaReceipt && line("M-PESA REF", sale.mpesaReceipt)}
      </div>
    );
  }
  return (
    <div className="space-y-0.5">
      {line("PAYMENT", `CASH ${formatAmount2(sale.tendered ?? sale.total)}`, true)}
      {sale.change !== null &&
        sale.change > 0 &&
        line("CHANGE", formatAmount2(sale.change))}
    </div>
  );
}
