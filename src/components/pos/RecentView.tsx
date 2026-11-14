import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/providers/trpc";
import { formatKes } from "@/lib/money";
import { paymentLabel } from "@/lib/labels";
import { ReceiptText } from "lucide-react";

// Full-page recent sales for the cashier (receipts + voids).
export function RecentView({
  onReceipt,
}: {
  onReceipt: (saleId: number) => void;
}) {
  const listQuery = trpc.sales.list.useQuery({ limit: 100 });
  const cancel = trpc.sales.cancel.useMutation({
    onSuccess: () => listQuery.refetch(),
  });

  const rows = listQuery.data ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
        <div>
          <p className="micro-label">History</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Recent sales
          </h1>
        </div>

        {listQuery.isLoading ? (
          <p className="text-sm text-muted-foreground py-6">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
            <ReceiptText className="size-6 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm">No sales yet.</p>
          </div>
        ) : (
          <ul className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
            {rows.map((sale) => (
              <li key={sale.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{sale.receiptNo}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(sale.createdAt).toLocaleString("en-KE")} ·{" "}
                    {paymentLabel(sale.paymentMethod)}
                    {sale.customerName ? ` · ${sale.customerName}` : ""}
                  </p>
                </div>
                <StatusBadge status={sale.status} />
                <span className="font-figures text-sm font-semibold">
                  {formatKes(sale.total)}
                </span>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border h-8"
                    onClick={() => onReceipt(sale.id)}
                  >
                    Receipt
                  </Button>
                  {(sale.status === "completed" || sale.status === "pending") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-destructive hover:text-destructive"
                      disabled={cancel.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Cancel ${sale.receiptNo}? Stock will be restored.`,
                          )
                        ) {
                          cancel.mutate({ saleId: sale.id });
                        }
                      }}
                    >
                      Void
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "border-primary/50 text-primary",
    pending: "border-warning/60 text-warning",
    failed: "border-destructive/60 text-destructive",
    cancelled: "border-muted-foreground/40 text-muted-foreground",
  };
  return (
    <Badge
      variant="outline"
      className={`text-[10px] uppercase tracking-wide ${styles[status] ?? ""}`}
    >
      {status}
    </Badge>
  );
}
