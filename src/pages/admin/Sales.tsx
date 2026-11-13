import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { StatusBadge } from "@/pages/Pos";
import { ReceiptDialog } from "@/components/pos/ReceiptDialog";

export default function Sales() {
  const [shop, setShop] = useState<"all" | "A" | "B">("all");
  const [status, setStatus] = useState<string>("all");
  const [receiptSaleId, setReceiptSaleId] = useState<number | null>(null);
  const [page, setPage] = useState(0);

  const listQuery = trpc.sales.list.useQuery({
    shop: shop === "all" ? undefined : shop,
    status:
      status === "all"
        ? undefined
        : (status as "completed" | "pending" | "failed" | "cancelled"),
    limit: 50,
    offset: page * 50,
  });
  const cancel = trpc.sales.cancel.useMutation({
    onSuccess: () => listQuery.refetch(),
  });
  const settingsQuery = trpc.settings.get.useQuery();

  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <p className="micro-label">Transactions</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Sales</h1>
      </div>

      <div className="flex gap-2">
        <Select
          value={shop}
          onValueChange={(v) => {
            setShop(v as "all" | "A" | "B");
            setPage(0);
          }}
        >
          <SelectTrigger className="w-36 bg-card border-input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="all">Both shops</SelectItem>
            <SelectItem value="A">Shop A</SelectItem>
            <SelectItem value="B">Shop B</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-36 bg-card border-input">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover border-border">
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Receipt</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead>Cashier</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((sale) => (
              <TableRow key={sale.id} className="border-border">
                <TableCell className="font-medium">{sale.receiptNo}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {new Date(sale.createdAt).toLocaleString("en-KE", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell>{sale.shop}</TableCell>
                <TableCell className="text-muted-foreground">{sale.cashierName}</TableCell>
                <TableCell className="capitalize text-muted-foreground">{sale.mode}</TableCell>
                <TableCell>{sale.paymentMethod === "megapay" ? "M-Pesa" : "Cash"}</TableCell>
                <TableCell>
                  <StatusBadge status={sale.status} />
                </TableCell>
                <TableCell className="text-right font-figures font-semibold">
                  {formatKes(sale.total)}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setReceiptSaleId(sale.id)}
                    >
                      View
                    </Button>
                    {(sale.status === "completed" || sale.status === "pending") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={cancel.isPending}
                        onClick={() => {
                          if (window.confirm(`Void ${sale.receiptNo}? Stock will be restored.`)) {
                            cancel.mutate({ saleId: sale.id });
                          }
                        }}
                      >
                        Void
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="border-border">
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  No sales match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-border"
          disabled={page === 0}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button
          variant="outline"
          size="sm"
          className="border-border"
          disabled={rows.length < 50}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>

      <ReceiptDialog
        saleId={receiptSaleId}
        open={receiptSaleId !== null}
        onOpenChange={(open) => !open && setReceiptSaleId(null)}
        businessName={settingsQuery.data?.businessName ?? "Comrade Shop"}
      />
    </div>
  );
}
