import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { trpc } from "@/providers/trpc";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { useCartTabs } from "@/components/pos/useCartTabs";
import { cartTotal, MAX_TABS, type CatalogProduct } from "@/components/pos/types";
import { CheckoutDialog, type CompletedSale } from "@/components/pos/CheckoutDialog";
import { ReceiptDialog } from "@/components/pos/ReceiptDialog";
import {
  Search,
  Plus,
  Minus,
  X,
  LogOut,
  ReceiptText,
  Trash2,
  Tag,
  ShoppingCart,
} from "lucide-react";

export default function Pos() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const shop = user?.shop ?? null;

  const settingsQuery = trpc.settings.get.useQuery(undefined, { retry: false });
  const catalogQuery = trpc.products.listForShop.useQuery(
    { shop: shop ?? "A" },
    { enabled: shop !== null, refetchInterval: 60_000 },
  );

  const cart = useCartTabs(shop ?? "A");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptSaleId, setReceiptSaleId] = useState<number | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [mobileCartOpen, setMobileCartOpen] = useState(false);

  const catalog = useMemo(
    () => (catalogQuery.data ?? []) as CatalogProduct[],
    [catalogQuery.data],
  );
  const categories = useMemo(
    () => [...new Set(catalog.map((p) => p.category))].sort(),
    [catalog],
  );
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return catalog.filter(
      (p) =>
        (!category || p.category === category) &&
        (!term ||
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term)),
    );
  }, [catalog, search, category]);

  if (!user || user.role !== "cashier" || !shop) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-6">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Log in as a shop cashier to use the till.</p>
          <Button onClick={() => navigate("/")} className="bg-primary text-primary-foreground">
            Go to login
          </Button>
        </div>
      </div>
    );
  }

  const shopName = shop === "A"
    ? settingsQuery.data?.shopAName ?? "Shop A"
    : settingsQuery.data?.shopBName ?? "Shop B";
  const totals = cartTotal(cart.active);

  function completeSale(result: CompletedSale) {
    setCheckoutOpen(false);
    setMobileCartOpen(false);
    setReceiptSaleId(result.saleId);
    cart.clearActive();
    catalogQuery.refetch();
  }

  return (
    <div className="h-dvh flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
          <span className="font-display font-semibold tracking-tight">
            {settingsQuery.data?.businessName ?? "Comrade Shop"}
          </span>
        </div>
        <Badge
          variant="outline"
          className="border-primary/50 text-primary font-display"
        >
          {shopName}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground hidden sm:block">
            {user.displayName}
          </span>
          <Sheet open={recentOpen} onOpenChange={setRecentOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="border-border gap-1.5">
                <ReceiptText className="size-4" />
                Recent
              </Button>
            </SheetTrigger>
            <SheetContent className="bg-card border-border w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="font-display">Recent sales — Shop {shop}</SheetTitle>
              </SheetHeader>
              <RecentSales
                onReprint={(id) => {
                  setReceiptSaleId(id);
                  setRecentOpen(false);
                }}
              />
            </SheetContent>
          </Sheet>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-muted-foreground hover:text-foreground gap-1.5"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Product grid */}
        <section className="relative flex-1 flex flex-col min-w-0 border-r border-border">
          <div className="p-3 space-y-2.5 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product or SKU…"
                className="pl-9 bg-card border-input h-10"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              <FilterChip
                active={category === null}
                onClick={() => setCategory(null)}
                label="All"
              />
              {categories.map((c) => (
                <FilterChip
                  key={c}
                  active={category === c}
                  onClick={() => setCategory(category === c ? null : c)}
                  label={c}
                />
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {catalogQuery.isLoading ? (
              <p className="text-sm text-muted-foreground p-4">Loading products…</p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-muted-foreground p-4">
                No products match. Add products from the admin panel.
              </p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                {visible.map((p) => {
                  const price =
                    cart.active.mode === "retail" ? p.retailPrice : p.wholesalePrice;
                  const out = p.stockQty <= 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={out}
                      onClick={() => cart.addProduct(p)}
                      className={`text-left rounded-md border p-3 transition-colors cursor-pointer ${
                        out
                          ? "border-border bg-card/50 opacity-45 cursor-not-allowed"
                          : "border-border bg-card hover:border-primary/60 hover:bg-secondary"
                      }`}
                    >
                      <p className="text-sm font-medium leading-snug line-clamp-2 min-h-10">
                        {p.name}
                      </p>
                      <div className="mt-2 flex items-baseline justify-between gap-1">
                        <span className="font-figures font-semibold text-primary">
                          {formatKes(price)}
                        </span>
                        <span
                          className={`text-[11px] ${
                            p.stockQty <= 5 ? "text-warning" : "text-muted-foreground"
                          }`}
                        >
                          {out ? "Out of stock" : `${formatQty(p.stockQty)} ${p.unit}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mobile cart toggle */}
          {!mobileCartOpen && (
            <button
              type="button"
              onClick={() => setMobileCartOpen(true)}
              className="md:hidden absolute bottom-4 right-4 z-30 flex items-center gap-2.5 rounded-full bg-primary text-primary-foreground pl-4 pr-5 py-3 font-display font-semibold cursor-pointer"
            >
              <ShoppingCart className="size-5" />
              <span className="font-figures text-sm">
                {formatQty(totals.items)} items
              </span>
              <span className="font-figures">{formatKes(totals.total)}</span>
            </button>
          )}
        </section>

        {/* Cart */}
        <section
          className={`${
            mobileCartOpen ? "fixed inset-0 z-40 flex" : "hidden"
          } md:static md:z-auto md:flex md:w-[380px] lg:w-[420px] flex-col shrink-0 bg-background md:bg-card/40`}
        >
          {/* Tabs */}
          <div className="flex items-center gap-1 px-2 pt-2 shrink-0">
            {cart.tabs.map((tab) => {
              const t = cartTotal(tab);
              const isActive = tab.id === cart.active.id;
              return (
                <div
                  key={tab.id}
                  className={`group flex items-center gap-1 rounded-t-md px-3 py-2 text-sm cursor-pointer border border-b-0 transition-colors ${
                    isActive
                      ? "bg-card border-border text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => cart.setActiveId(tab.id)}
                >
                  <span className="font-medium">{tab.label}</span>
                  {t.items > 0 && (
                    <span className="font-figures text-[11px] text-primary">
                      {formatPlain(t.total)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Close ${tab.label}`}
                    className="ml-1 opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      cart.closeTab(tab.id);
                    }}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
            {cart.tabs.length < MAX_TABS && (
              <button
                type="button"
                onClick={cart.addTab}
                aria-label="New sale tab"
                className="flex items-center gap-1 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer"
              >
                <Plus className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileCartOpen(false)}
              className="ml-auto md:hidden flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="size-4" />
              Done
            </button>
          </div>

          {/* Mode + customer */}
          <div className="border-t border-border px-3 py-2.5 space-y-2 shrink-0 bg-card">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-secondary p-1">
              {(["retail", "wholesale"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => cart.switchMode(mode, catalog)}
                  className={`rounded px-2 py-1.5 text-sm font-medium capitalize transition-colors cursor-pointer ${
                    cart.active.mode === mode
                      ? mode === "wholesale"
                        ? "bg-warning text-warning-foreground"
                        : "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <Input
              value={cart.active.customerName}
              onChange={(e) =>
                cart.updateTab(cart.active.id, (t) => ({
                  ...t,
                  customerName: e.target.value,
                }))
              }
              placeholder="Customer name (optional)"
              className="bg-background border-input h-9 text-sm"
            />
          </div>

          {/* Lines */}
          <div className="flex-1 overflow-y-auto border-t border-border bg-card">
            {cart.active.lines.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground p-6">
                <Tag className="size-6" strokeWidth={1.5} />
                <p className="text-sm">Tap products to add them to {cart.active.label}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {cart.active.lines.map((line) => (
                  <CartLineRow
                    key={line.productId}
                    line={line}
                    onQty={(qty) => cart.updateLine(line.productId, { qty })}
                    onPrice={(unitPrice) =>
                      cart.updateLine(line.productId, { unitPrice })
                    }
                    onRemove={() => cart.removeLine(line.productId)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Totals + checkout */}
          <div className="border-t border-border p-3 space-y-2.5 shrink-0 bg-card">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Discount (KES)</span>
              <Input
                className="w-28 h-8 bg-background border-input font-figures text-right"
                inputMode="decimal"
                placeholder="0"
                value={
                  cart.active.discount === 0
                    ? ""
                    : formatPlain(cart.active.discount)
                }
                onChange={(e) => {
                  const cents = parseKes(e.target.value) ?? 0;
                  cart.updateTab(cart.active.id, (t) => ({
                    ...t,
                    discount: Math.min(cents, cartTotal(t).subtotal),
                  }));
                }}
              />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="micro-label">
                Total · {formatQty(totals.items)} items
              </span>
              <span className="font-figures text-3xl font-semibold tracking-tight">
                {formatKes(totals.total)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-border text-muted-foreground"
                disabled={cart.active.lines.length === 0}
                onClick={cart.clearActive}
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                className="flex-1 h-12 bg-primary text-primary-foreground hover:bg-primary/90 font-display font-semibold text-base"
                disabled={cart.active.lines.length === 0}
                onClick={() => setCheckoutOpen(true)}
              >
                Charge {formatKes(totals.total)}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        tab={cart.active}
        shop={shop}
        megapayEnabled={shop === "A" && (settingsQuery.data?.megapayConfigured ?? false)}
        onCompleted={completeSale}
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

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
        active
          ? "border-primary bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function CartLineRow({
  line,
  onQty,
  onPrice,
  onRemove,
}: {
  line: {
    productId: number;
    name: string;
    unit: string;
    qty: number;
    unitPrice: number;
    listPrice: number;
    allowBargain: boolean;
  };
  onQty: (qty: number) => void;
  onPrice: (price: number) => void;
  onRemove: () => void;
}) {
  const [priceText, setPriceText] = useState<string | null>(null);
  const bargained = line.unitPrice !== line.listPrice;

  return (
    <li className="px-3 py-2.5 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug">{line.name}</p>
        <button
          type="button"
          aria-label="Remove line"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <QtyButton
            aria-label="Decrease quantity"
            onClick={() => onQty(Math.max(1, line.qty - 1))}
            icon={<Minus className="size-3.5" />}
          />
          <span className="w-10 text-center font-figures text-sm">
            {formatQty(line.qty)}
          </span>
          <QtyButton
            aria-label="Increase quantity"
            onClick={() => onQty(line.qty + 1)}
            icon={<Plus className="size-3.5" />}
          />
          <span className="text-[11px] text-muted-foreground ml-1">{line.unit}</span>
        </div>
        <div className="flex items-center gap-2">
          {line.allowBargain ? (
            <div className="relative">
              <Input
                aria-label={`Price for ${line.name}`}
                className={`w-24 h-8 font-figures text-right text-sm bg-background ${
                  bargained ? "border-warning text-warning" : "border-input"
                }`}
                inputMode="decimal"
                value={priceText ?? formatPlain(line.unitPrice)}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  const cents = parseKes(e.target.value);
                  if (cents !== null) onPrice(cents);
                }}
                onBlur={() => setPriceText(null)}
              />
              {bargained && (
                <span className="absolute -top-4 right-0 text-[10px] text-warning line-through font-figures">
                  {formatPlain(line.listPrice)}
                </span>
              )}
            </div>
          ) : (
            <span className="font-figures text-sm text-muted-foreground">
              @{formatPlain(line.unitPrice)}
            </span>
          )}
          <span className="font-figures font-semibold w-20 text-right">
            {formatKes(Math.round(line.unitPrice * line.qty))}
          </span>
        </div>
      </div>
    </li>
  );
}

function QtyButton({
  onClick,
  icon,
  ...rest
}: {
  onClick: () => void;
  icon: React.ReactNode;
} & React.AriaAttributes) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="size-7 rounded border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors cursor-pointer"
      {...rest}
    >
      {icon}
    </button>
  );
}

function RecentSales({ onReprint }: { onReprint: (saleId: number) => void }) {
  const listQuery = trpc.sales.list.useQuery({ limit: 50 });
  const cancel = trpc.sales.cancel.useMutation({
    onSuccess: () => listQuery.refetch(),
  });

  if (listQuery.isLoading)
    return <p className="text-sm text-muted-foreground py-4">Loading…</p>;
  const rows = listQuery.data ?? [];
  if (rows.length === 0)
    return (
      <p className="text-sm text-muted-foreground py-4">No sales yet today.</p>
    );

  return (
    <ul className="divide-y divide-border mt-2">
      {rows.map((sale) => (
        <li key={sale.id} className="py-2.5 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{sale.receiptNo}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(sale.createdAt).toLocaleTimeString("en-KE")} ·{" "}
              {sale.paymentMethod === "megapay" ? "M-Pesa" : "Cash"} ·{" "}
              {sale.mode}
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
              onClick={() => onReprint(sale.id)}
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
                  if (window.confirm(`Cancel ${sale.receiptNo}? Stock will be restored.`)) {
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
    <Badge variant="outline" className={`text-[10px] uppercase tracking-wide ${styles[status] ?? ""}`}>
      {status}
    </Badge>
  );
}
