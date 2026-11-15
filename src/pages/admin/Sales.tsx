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
import { errorMessage } from "@/lib/auth";
import { formatKes } from "@/lib/money";
import { paymentLabel } from "@/lib/labels";
import { StatusBadge } from "@/components/pos/RecentView";
import { ReceiptDialog } from "@/components/pos/ReceiptDialog";
import { Pencil, Trash2 } from "lucide-react";

type SaleRow = {
  id: number;
  receiptNo: string;
  shop: string;
  cashierName: string;
  mode: string;
  paymentMethod: string;
  status: string;
  total: number;
  debtId: number | null;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string;
};

export default function Sales() {
  const [shop, setShop] = useState<"all" | "A" | "B">("all");
  const [status, setStatus] = useState<string>("all");
  const [receiptSaleId, setReceiptSaleId] = useState<number | null>(null);
  const [editing, setEditing] = useState<SaleRow | null>(null);
  const [deleting, setDeleting] = useState<SaleRow | null>(null);
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

  const rows = (listQuery.data ?? []) as SaleRow[];

  return (
    <div className="space-y-5">
      <div>
        <p className="micro-label">Transactions</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Sales</h1>
        <p className="text-sm text-muted-foreground mt-1">
          View, correct or remove any transaction — changes apply to reports,
          stock and debts immediately.
        </p>
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
                <TableCell>{paymentLabel(sale.paymentMethod)}</TableCell>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground gap-1"
                      onClick={() => setEditing(sale)}
                    >
                      <Pencil className="size-3.5" />
                      Edit
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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${sale.receiptNo}`}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10 size-8"
                      onClick={() => setDeleting(sale)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
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
      <EditSaleDialog
        sale={editing}
        onClose={() => setEditing(null)}
        onSaved={() => listQuery.refetch()}
      />
      <DeleteSaleDialog
        sale={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => listQuery.refetch()}
      />
    </div>
  );
}

function EditSaleDialog({
  sale,
  onClose,
  onSaved,
}: {
  sale: SaleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  // Populate the form when a different sale is opened.
  if (sale && sale.id !== loadedFor) {
    setLoadedFor(sale.id);
    setPaymentMethod(sale.paymentMethod);
    setStatus(sale.status);
    setCustomerName(sale.customerName ?? "");
    setCustomerPhone(sale.customerPhone ?? "");
    setError(null);
  }

  const update = trpc.sales.update.useMutation({
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(o) => {
        if (!o) {
          setLoadedFor(null);
          onClose();
        }
      }}
    >
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            Edit {sale?.receiptNo}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Correct this transaction's details
          </DialogDescription>
        </DialogHeader>
        {sale && (
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Payment method</Label>
                <Select
                  value={paymentMethod}
                  onValueChange={setPaymentMethod}
                  disabled={sale.debtId !== null}
                >
                  <SelectTrigger className="bg-background border-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="megapay">M-Pesa</SelectItem>
                    <SelectItem value="split">Cash + M-Pesa</SelectItem>
                    <SelectItem value="debt">Debt</SelectItem>
                  </SelectContent>
                </Select>
                {sale.debtId !== null && (
                  <p className="text-[11px] text-muted-foreground">
                    Linked to a customer debt — void or delete it to change how
                    it was paid.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="bg-background border-input">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {status === "cancelled" && sale.status !== "cancelled" && (
              <p className="text-xs text-warning">
                Cancelling restores the stock and reduces any linked debt.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Customer name</Label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="bg-background border-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Customer phone</Label>
                <Input
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  className="bg-background border-input font-figures"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({
                  id: sale.id,
                  paymentMethod:
                    paymentMethod as "cash" | "megapay" | "split" | "debt",
                  status: status as
                    | "completed"
                    | "pending"
                    | "failed"
                    | "cancelled",
                  customerName: customerName.trim() || null,
                  customerPhone: customerPhone.trim() || null,
                })
              }
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteSaleDialog({
  sale,
  onClose,
  onDeleted,
}: {
  sale: SaleRow | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const remove = trpc.sales.remove.useMutation({
    onSuccess: () => {
      setError(null);
      onDeleted();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            Delete {sale?.receiptNo}?
          </DialogTitle>
          <DialogDescription className="sr-only">
            Permanently delete this transaction
          </DialogDescription>
        </DialogHeader>
        {sale && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This permanently removes the{" "}
              <span className="text-foreground font-medium">
                {formatKes(sale.total)}
              </span>{" "}
              sale from records and reports. The items go back into stock
              {sale.debtId !== null &&
                " and the amount is pulled out of the customer's debt tab"}
              . This cannot be undone.
            </p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-border"
                onClick={onClose}
              >
                Keep it
              </Button>
              <Button
                variant="destructive"
                className="flex-1 font-semibold"
                disabled={remove.isPending}
                onClick={() => remove.mutate({ id: sale.id })}
              >
                {remove.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
