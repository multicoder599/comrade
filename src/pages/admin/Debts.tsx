import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DebtDetailDialog,
  DebtStatusBadge,
  DebtBalance,
} from "@/components/pos/DebtDetailDialog";
import { ReceiptDialog } from "@/components/pos/ReceiptDialog";
import { BookUser, Plus, Search, Trash2 } from "lucide-react";

type StatusFilter = "active" | "open" | "partial" | "settled" | "all";

export default function Debts() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<number | null>(null);

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
  const settingsQuery = trpc.settings.get.useQuery(undefined, { retry: false });

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

      <DebtCustomersSection />

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
                <TableCell className="text-right">
                  <DebtBalance debt={d} />
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
        onReceipt={(id) => setReceiptSaleId(id)}
      />
      <ReceiptDialog
        saleId={receiptSaleId}
        open={receiptSaleId !== null}
        onOpenChange={(open) => !open && setReceiptSaleId(null)}
        businessName={settingsQuery.data?.businessName ?? "Comrade Shop"}
      />
    </div>
  );
}

/**
 * Debt customers register — only the admin adds or removes people here, and
 * cashiers can sell on debt only to someone on this list.
 */
function DebtCustomersSection() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [shop, setShop] = useState<"A" | "B">("A");
  const [error, setError] = useState<string | null>(null);

  const customersQuery = trpc.debts.customers.useQuery();
  const addCustomer = trpc.debts.addCustomer.useMutation({
    onSuccess: () => {
      customersQuery.refetch();
      setName("");
      setPhone("");
      setError(null);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const removeCustomer = trpc.debts.removeCustomer.useMutation({
    onSuccess: () => customersQuery.refetch(),
    onError: (e) => window.alert(errorMessage(e)),
  });

  function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 9) {
      setError("Enter the customer's name and a valid phone number");
      return;
    }
    addCustomer.mutate({ shop, name: name.trim(), phone: phone.trim() });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BookUser className="size-4 text-primary" />
        <div>
          <h2 className="font-display font-semibold">Debt customers</h2>
          <p className="text-xs text-muted-foreground">
            Cashiers can only sell on debt to people on this list.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_auto_auto] gap-2.5 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Customer name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Mama Njoroge"
            className="bg-background border-input h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Phone number</Label>
          <Input
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0712 345 678"
            className="bg-background border-input h-9 text-sm font-figures"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Shop</Label>
          <div className="grid grid-cols-2 gap-1 rounded-md border border-border p-0.5 h-9">
            {(["A", "B"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setShop(s)}
                className={`rounded text-xs font-semibold transition-colors cursor-pointer ${
                  shop === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold h-9"
          disabled={addCustomer.isPending || !name.trim() || !phone.trim()}
          onClick={submit}
        >
          <Plus className="size-4 mr-1" />
          {addCustomer.isPending ? "Adding…" : "Add customer"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {(customersQuery.data ?? []).length > 0 ? (
        <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
          {customersQuery.data!.map((c) => (
            <li
              key={c.id}
              className="px-3 py-2 flex items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground font-figures ml-2">
                  {c.phone}
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  Shop {c.shop}
                </span>
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {c.owes > 0 && (
                  <span className="text-xs font-figures text-warning">
                    owes {formatKes(c.owes)}
                  </span>
                )}
                {c.credit > 0 && (
                  <span className="text-xs font-figures text-success">
                    credit {formatKes(c.credit)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-muted-foreground hover:text-destructive"
                  disabled={removeCustomer.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove ${c.name} from the debt list? They will no longer be able to buy on debt.`,
                      )
                    ) {
                      removeCustomer.mutate({ id: c.id });
                    }
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No customers registered yet — add the first one above.
        </p>
      )}
    </section>
  );
}
