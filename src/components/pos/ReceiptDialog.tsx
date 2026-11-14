import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/providers/trpc";
import { formatKes, formatQty } from "@/lib/money";
import { Printer } from "lucide-react";

type Props = {
  saleId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessName: string;
};

export function ReceiptDialog({ saleId, open, onOpenChange, businessName }: Props) {
  const query = trpc.sales.get.useQuery(
    { id: saleId ?? 0 },
    { enabled: open && saleId !== null },
  );
  const data = query.data;

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
            <div
              id="receipt-print"
              className="rounded-md bg-background border border-border p-4 font-figures text-[13px] leading-relaxed"
            >
              <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-border">
                <p className="font-semibold text-sm tracking-wide uppercase">
                  {businessName}
                </p>
                <p className="text-muted-foreground">
                  Shop {data.sale.shop} · {data.sale.receiptNo}
                </p>
                <p className="text-muted-foreground">
                  {new Date(data.sale.createdAt).toLocaleString("en-KE")} ·{" "}
                  {data.sale.cashierName}
                </p>
              </div>
              <div className="py-2 space-y-1 border-b border-dashed border-border">
                {data.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {item.name}
                      {item.priceType === "wholesale" && (
                        <span className="text-warning"> (W)</span>
                      )}
                      <span className="text-muted-foreground">
                        {" "}
                        ×{formatQty(item.qty)} @ {formatKes(item.unitPrice)}
                      </span>
                    </span>
                    <span>{formatKes(item.lineTotal)}</span>
                  </div>
                ))}
              </div>
              <div className="py-2 space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatKes(data.sale.subtotal)}</span>
                </div>
                {data.sale.discount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Discount</span>
                    <span>-{formatKes(data.sale.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-base">
                  <span>TOTAL</span>
                  <span>{formatKes(data.sale.total)}</span>
                </div>
                {data.sale.paymentMethod === "split" ? (
                  <>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Cash part</span>
                      <span>{formatKes(data.sale.cashAmount ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>
                        M-Pesa part
                        {data.sale.mpesaReceipt ? ` · ${data.sale.mpesaReceipt}` : ""}
                      </span>
                      <span>{formatKes(data.sale.mpesaAmount ?? 0)}</span>
                    </div>
                    {data.sale.tendered !== null && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Cash received</span>
                        <span>
                          {formatKes(data.sale.tendered)} · change{" "}
                          {formatKes(data.sale.change ?? 0)}
                        </span>
                      </div>
                    )}
                  </>
                ) : data.sale.paymentMethod === "debt" ? (
                  <div className="flex justify-between text-muted-foreground">
                    <span>DEBT — pay later</span>
                    <span>
                      {data.sale.customerName ?? ""}
                      {data.sale.customerPhone
                        ? ` · ${data.sale.customerPhone}`
                        : ""}
                    </span>
                  </div>
                ) : (
                  <div className="flex justify-between text-muted-foreground">
                    <span>
                      {data.sale.paymentMethod === "megapay"
                        ? `M-Pesa${data.sale.mpesaReceipt ? ` · ${data.sale.mpesaReceipt}` : ""}`
                        : "Cash"}
                    </span>
                    {data.sale.tendered !== null && (
                      <span>
                        {formatKes(data.sale.tendered)} · change{" "}
                        {formatKes(data.sale.change ?? 0)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <p className="text-center text-muted-foreground pt-2 border-t border-dashed border-border">
                Asante! Karibu tena.
              </p>
            </div>
            <Button
              variant="outline"
              className="border-border"
              onClick={() => window.print()}
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
