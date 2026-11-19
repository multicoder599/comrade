import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { usePortGuard } from "@/lib/ports";
import { trpc } from "@/providers/trpc";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { useCartTabs } from "@/components/pos/useCartTabs";
import {
  cartTotal,
  lineTotal,
  MAX_TABS,
  type CartLine,
  type CartTab,
  type CatalogProduct,
} from "@/components/pos/types";
import {
  CheckoutDialog,
  type CompletedSale,
} from "@/components/pos/CheckoutDialog";
import { ReceiptDialog } from "@/components/pos/ReceiptDialog";
import { UpdateBanner } from "@/components/UpdateBanner";
import { DebtsView } from "@/components/pos/DebtsView";
import { RecentView } from "@/components/pos/RecentView";
import { CashierDbView } from "@/components/pos/CashierDbView";
import {
  Search,
  Plus,
  Minus,
  X,
  LogOut,
  ReceiptText,
  Trash2,
  Tag,
  ScanBarcode,
  Loader2,
  Smartphone,
  ShoppingCart,
  Wallet,
  Database,
  Store,
} from "lucide-react";

type PosView = "till" | "debts" | "recent" | "database";

const NAV_ITEMS: { key: PosView; label: string; icon: typeof Wallet }[] = [
  { key: "till", label: "Till", icon: ShoppingCart },
  { key: "debts", label: "Debts", icon: Wallet },
  { key: "recent", label: "Recent", icon: ReceiptText },
  { key: "database", label: "Database", icon: Database },
];

export default function Pos() {
  usePortGuard("shop");
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const shop = user?.shop ?? null;

  const settingsQuery = trpc.settings.get.useQuery(undefined, { retry: false });
  const catalogQuery = trpc.products.listForShop.useQuery(
    { shop: shop ?? "A" },
    { enabled: shop !== null, refetchInterval: 60_000 },
  );

  const cart = useCartTabs(shop ?? "A");
  const [view, setView] = useState<PosView>("till");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [receiptSaleId, setReceiptSaleId] = useState<number | null>(null);
  const [pricePrompt, setPricePrompt] = useState<CatalogProduct | null>(null);
  const [scanText, setScanText] = useState("");
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const refreshPayment = trpc.sales.refreshPayment.useMutation();
  const cancelSale = trpc.sales.cancel.useMutation();
  const utils = trpc.useUtils();

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
          p.sku.toLowerCase().includes(term) ||
          (p.barcode ?? "").toLowerCase().includes(term)),
    );
  }, [catalog, search, category]);

  // Background watcher: pending M-Pesa carts keep polling while the cashier
  // serves other customers. On completion the receipt pops up automatically.
  const pendingKey = cart.tabs
    .filter((t) => t.pending)
    .map((t) => `${t.id}:${t.pending!.saleId}`)
    .join(",");
  const pollAttempts = useRef<Record<string, number>>({});
  useEffect(() => {
    const pendingTabs = cart.tabs.filter((t) => t.pending);
    if (pendingTabs.length === 0) return;
    let cancelled = false;

    async function poll(tab: CartTab) {
      const pending = tab.pending!;
      try {
        const sale = await refreshPayment.mutateAsync({ saleId: pending.saleId });
        if (cancelled) return;
        if (sale.status === "completed") {
          pollAttempts.current[tab.id] = 0;
          cart.clearTab(tab.id);
          setReceiptSaleId(sale.id);
          utils.products.listForShop.invalidate();
        } else if (sale.status === "failed") {
          pollAttempts.current[tab.id] = 0;
          cart.setPending(tab.id, null);
          cart.setNotice(
            tab.id,
            "M-Pesa payment failed or was cancelled — stock restored. Check out again to retry.",
          );
        } else {
          const attempts = (pollAttempts.current[tab.id] ?? 0) + 1;
          pollAttempts.current[tab.id] = attempts;
          if (attempts > 45) {
            pollAttempts.current[tab.id] = 0;
            cart.setPending(tab.id, null);
            cart.setNotice(
              tab.id,
              "Stopped waiting for that M-Pesa prompt. Check Recent sales for its final status.",
            );
          }
        }
      } catch {
        /* transient network error — try again on the next tick */
      }
    }

    const iv = setInterval(() => {
      for (const tab of pendingTabs) void poll(tab);
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

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

  function flashScanNotice(message: string) {
    setScanNotice(message);
    setTimeout(() => setScanNotice(null), 3500);
  }

  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = scanText.trim();
    if (!code) return;
    const hit =
      catalog.find((p) => p.barcode === code) ??
      catalog.find((p) => p.sku.toLowerCase() === code.toLowerCase());
    // A pack's own barcode scans straight in as one pack at the pack price.
    const packHit = hit
      ? null
      : catalog
          .flatMap((p) => p.packages.map((pk) => ({ product: p, pack: pk })))
          .find((x) => x.pack.barcode === code);
    if (!hit && !packHit) {
      flashScanNotice(`No product matches "${code}"`);
    } else if (hit) {
      if (hit.stockQty <= 0) {
        flashScanNotice(`"${hit.name}" is out of stock`);
      } else {
        cart.addProduct(hit);
        flashScanNotice(`Added ${hit.name}`);
      }
    } else if (packHit) {
      const { product, pack: pk } = packHit;
      if (product.stockQty < pk.qty) {
        flashScanNotice(
          `Not enough ${product.name} for a ${pk.name} (${formatQty(product.stockQty)} ${product.unit} left)`,
        );
      } else {
        cart.addProduct(product, {
          pack: { id: pk.id, name: pk.name, units: pk.qty, price: pk.price },
        });
        flashScanNotice(`Added ${product.name} — ${pk.name}`);
      }
    }
    setScanText("");
    scanInputRef.current?.focus();
  }

  function openCheckout(tabId: string) {
    cart.setActiveId(tabId);
    setCheckoutOpen(true);
  }

  function completeSale(result: CompletedSale) {
    setCheckoutOpen(false);
    setReceiptSaleId(result.saleId);
    cart.clearActive();
    catalogQuery.refetch();
  }

  const mobileNavButton = (item: (typeof NAV_ITEMS)[number]) => (
    <button
      key={item.key}
      type="button"
      onClick={() => setView(item.key)}
      className={`flex flex-row gap-1.5 px-3 py-2 items-center justify-center rounded-md text-xs font-medium transition-colors cursor-pointer ${
        view === item.key
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      }`}
    >
      <item.icon className="size-4" strokeWidth={1.75} />
      {item.label}
    </button>
  );

  return (
    <div className="h-dvh flex flex-col md:flex-row bg-background overflow-hidden">
      {/* Mobile top bar */}
      <header className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))] shrink-0" />
        <span className="font-display font-semibold tracking-tight text-sm truncate">
          {settingsQuery.data?.businessName ?? "Comrade Shop"}
        </span>
        <Badge
          variant="outline"
          className="border-primary/50 text-primary font-display text-[10px] shrink-0"
        >
          {shopName}
        </Badge>
        <button
          type="button"
          onClick={logout}
          aria-label="Log out"
          className="ml-auto text-muted-foreground hover:text-foreground cursor-pointer p-1.5"
        >
          <LogOut className="size-4" />
        </button>
      </header>
      {/* Mobile nav row */}
      <nav className="md:hidden grid grid-cols-4 gap-1 px-2 py-1.5 border-b border-border shrink-0">
        {NAV_ITEMS.map((item) => mobileNavButton(item))}
      </nav>

      {/* Desktop left rail */}
      <aside className="hidden md:flex w-48 shrink-0 border-r border-border bg-card flex-col">
        <div className="flex items-center gap-2.5 px-3.5 py-4 border-b border-border">
          <span className="size-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Store className="size-4" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="font-display font-semibold text-sm leading-tight truncate">
              {settingsQuery.data?.businessName ?? "Comrade Shop"}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {shopName}
            </p>
          </div>
        </div>
        <nav className="flex-1 p-2.5 space-y-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setView(item.key)}
              className={`w-full flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors cursor-pointer ${
                view === item.key
                  ? "bg-primary/15 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <item.icon className="size-4" strokeWidth={1.75} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-2.5 border-t border-border space-y-1">
          <p className="px-3 text-[11px] text-muted-foreground truncate">
            {user.displayName}
          </p>
          <button
            type="button"
            onClick={logout}
            className="w-full flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
          >
            <LogOut className="size-4" strokeWidth={1.75} />
            Log out
          </button>
        </div>
      </aside>

      {/* Content */}
      {view === "till" ? (
        <div className="flex-1 flex flex-col md:flex-row min-h-0 min-w-0">
          {/* Products + scanner */}
          <section className="relative flex-1 flex flex-col min-w-0 min-h-0">
            <div className="p-3 space-y-2.5 border-b border-border shrink-0">
              <div className="relative">
                <ScanBarcode className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-primary" />
                <Input
                  ref={scanInputRef}
                  value={scanText}
                  onChange={(e) => setScanText(e.target.value)}
                  onKeyDown={onScanKeyDown}
                  placeholder="Scan barcode or type SKU, then Enter…"
                  className="pl-9 pr-28 bg-card border-input h-10 font-figures"
                  autoFocus
                />
                <span
                  className={`absolute right-3 top-1/2 -translate-y-1/2 text-[11px] ${
                    scanNotice
                      ? scanNotice.startsWith("Added")
                        ? "text-success"
                        : "text-warning"
                      : "text-muted-foreground"
                  }`}
                >
                  {scanNotice ?? "Scanner ready"}
                </span>
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product…"
                    className="pl-9 bg-card border-input h-9 text-sm"
                  />
                </div>
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
                  No products match. Add products from the Database page or admin panel.
                </p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {visible.map((p) => {
                    const out = p.stockQty <= 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={out}
                        onClick={() => setPricePrompt(p)}
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
                            {formatKes(p.retailPrice)}
                          </span>
                          <span
                            className={`text-[11px] ${
                              p.stockQty <= p.lowStockAt ? "text-warning" : "text-muted-foreground"
                            }`}
                          >
                            {out ? "Out of stock" : `${formatQty(p.stockQty)} ${p.unit}`}
                          </span>
                        </div>
                        {p.packages.length > 0 && (
                          <p className="mt-1 text-[10px] font-figures text-warning truncate">
                            {p.packages
                              .map((pk) => `${pk.name} ${formatKes(pk.price)}`)
                              .join(" · ")}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Parallel carts */}
          <section className="shrink-0 h-[46dvh] md:h-auto border-t md:border-t-0 md:border-l border-border flex flex-col bg-card/40">
            <div className="flex-1 flex gap-2.5 overflow-x-auto snap-x snap-mandatory p-2.5 min-h-0">
              {cart.tabs.map((tab) => (
                <CartColumn
                  key={tab.id}
                  tab={tab}
                  isActive={tab.id === cart.active.id}
                  onFocus={() => cart.setActiveId(tab.id)}
                  onClose={() => cart.closeTab(tab.id)}
                  onQty={(key, qty) => cart.updateLine(key, { qty })}
                  onPrice={(key, unitPrice) => cart.updateLine(key, { unitPrice })}
                  onRemoveLine={(key) => cart.removeLine(key)}
                  onDiscount={(discount) =>
                    cart.updateTab(tab.id, (t) => ({
                      ...t,
                      discount: Math.min(discount, cartTotal(t).subtotal),
                    }))
                  }
                  onClear={() => cart.clearTab(tab.id)}
                  onCheckout={() => openCheckout(tab.id)}
                  onCheckPayment={async () => {
                    if (!tab.pending) return;
                    try {
                      const sale = await refreshPayment.mutateAsync({
                        saleId: tab.pending.saleId,
                      });
                      if (sale.status === "completed") {
                        cart.clearTab(tab.id);
                        setReceiptSaleId(sale.id);
                        utils.products.listForShop.invalidate();
                      } else if (sale.status === "failed") {
                        cart.setPending(tab.id, null);
                        cart.setNotice(
                          tab.id,
                          "M-Pesa payment failed or was cancelled — stock restored.",
                        );
                      } else {
                        cart.setNotice(tab.id, "Still waiting for the customer's PIN…");
                      }
                    } catch {
                      cart.setNotice(tab.id, "Could not reach the server — try again.");
                    }
                  }}
                  onCancelPending={() => {
                    if (!tab.pending) return;
                    if (
                      window.confirm(
                        `Cancel the pending M-Pesa sale ${tab.pending.receiptNo}? Stock will be restored.`,
                      )
                    ) {
                      cancelSale.mutate(
                        { saleId: tab.pending.saleId },
                        {
                          onSuccess: () => {
                            cart.setPending(tab.id, null);
                            cart.setNotice(tab.id, "Pending sale cancelled.");
                            utils.products.listForShop.invalidate();
                          },
                        },
                      );
                    }
                  }}
                  onDismissNotice={() => cart.setNotice(tab.id, null)}
                />
              ))}
              {cart.tabs.length < MAX_TABS && (
                <button
                  type="button"
                  onClick={cart.addTab}
                  className="shrink-0 w-16 md:w-20 rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1.5 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors cursor-pointer snap-start"
                >
                  <Plus className="size-5" />
                  <span className="text-[11px] font-medium">New sale</span>
                </button>
              )}
            </div>
          </section>
        </div>
      ) : view === "debts" ? (
        <div className="flex-1 min-h-0 min-w-0">
          <DebtsView onReceipt={(id) => setReceiptSaleId(id)} />
        </div>
      ) : view === "recent" ? (
        <div className="flex-1 min-h-0 min-w-0">
          <RecentView onReceipt={(id) => setReceiptSaleId(id)} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 min-w-0">
          <CashierDbView />
        </div>
      )}

      <AddPriceDialog
        product={pricePrompt}
        onClose={() => setPricePrompt(null)}
        onAdd={(product, opts) => {
          cart.addProduct(product, opts);
          setPricePrompt(null);
        }}
      />
      <CheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        tab={cart.active}
        megapayEnabled={settingsQuery.data?.megapayConfigured?.[shop] ?? false}
        onCompleted={completeSale}
        onPending={(pending) => {
          cart.setPending(cart.active.id, pending);
          setCheckoutOpen(false);
          catalogQuery.refetch();
        }}
      />
      <ReceiptDialog
        saleId={receiptSaleId}
        open={receiptSaleId !== null}
        onOpenChange={(open) => !open && setReceiptSaleId(null)}
        businessName={settingsQuery.data?.businessName ?? "Comrade Shop"}
        shopName={shopName}
      />
      <UpdateBanner />
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

type CartColumnProps = {
  tab: CartTab;
  isActive: boolean;
  onFocus: () => void;
  onClose: () => void;
  onQty: (key: string, qty: number) => void;
  onPrice: (key: string, unitPrice: number) => void;
  onRemoveLine: (key: string) => void;
  onDiscount: (discount: number) => void;
  onClear: () => void;
  onCheckout: () => void;
  onCheckPayment: () => void;
  onCancelPending: () => void;
  onDismissNotice: () => void;
};

function CartColumn({
  tab,
  isActive,
  onFocus,
  onClose,
  onQty,
  onPrice,
  onRemoveLine,
  onDiscount,
  onClear,
  onCheckout,
  onCheckPayment,
  onCancelPending,
  onDismissNotice,
}: CartColumnProps) {
  const totals = cartTotal(tab);
  const pending = tab.pending;

  return (
    <div
      onClick={onFocus}
      className={`shrink-0 w-[84vw] max-w-[340px] md:w-[300px] snap-center rounded-lg border flex flex-col min-h-0 overflow-hidden transition-colors ${
        isActive
          ? "border-primary/60 bg-card shadow-[0_0_0_1px_hsl(var(--primary)/0.35)]"
          : "border-border bg-card"
      }`}
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <span className="font-display font-semibold text-sm">{tab.label}</span>
        {isActive && (
          <Badge className="bg-primary text-primary-foreground text-[9px] uppercase tracking-wide px-1.5 py-0">
            Active
          </Badge>
        )}
        {pending && (
          <Badge
            variant="outline"
            className="border-warning/60 text-warning text-[9px] uppercase tracking-wide px-1.5 py-0"
          >
            M-Pesa…
          </Badge>
        )}
        <button
          type="button"
          aria-label={`Close ${tab.label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-auto text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
        >
          <X className="size-4" />
        </button>
      </div>

      {tab.notice && (
        <div className="flex items-start gap-2 px-3 py-2 bg-warning/10 border-b border-warning/30 text-warning text-xs shrink-0">
          <span className="flex-1">{tab.notice}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={(e) => {
              e.stopPropagation();
              onDismissNotice();
            }}
            className="cursor-pointer"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {pending ? (
        /* Waiting for the customer's M-Pesa PIN — other carts stay usable */
        <div className="flex-1 flex flex-col items-center justify-center gap-2.5 p-4 text-center">
          <Loader2 className="size-7 animate-spin text-primary" />
          <p className="text-sm font-medium">Waiting for M-Pesa PIN…</p>
          <p className="text-xs text-muted-foreground">
            <Smartphone className="inline size-3.5 mr-1 -mt-0.5" />
            {pending.phone}
            {pending.method === "split" ? " · split sale" : ""}
          </p>
          <p className="font-figures font-semibold">{formatKes(pending.total)}</p>
          <p className="text-[11px] text-muted-foreground">{pending.receiptNo}</p>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="border-border"
              onClick={(e) => {
                e.stopPropagation();
                onCheckPayment();
              }}
            >
              Check now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onCancelPending();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Lines */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {tab.lines.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-muted-foreground p-4">
                <Tag className="size-5" strokeWidth={1.5} />
                <p className="text-xs text-center">
                  Tap products to add them to {tab.label}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {tab.lines.map((line) => (
                  <CartLineRow
                    key={line.key}
                    line={line}
                    onQty={(qty) => onQty(line.key, qty)}
                    onPrice={(unitPrice) => onPrice(line.key, unitPrice)}
                    onRemove={() => onRemoveLine(line.key)}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Totals + checkout */}
          <div className="border-t border-border p-2.5 space-y-2 shrink-0 bg-card">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Discount</span>
              <Input
                className="w-20 h-7 bg-background border-input font-figures text-right text-xs"
                inputMode="decimal"
                placeholder="0"
                value={tab.discount === 0 ? "" : formatPlain(tab.discount)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onDiscount(parseKes(e.target.value) ?? 0)}
              />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="micro-label">
                Total · {formatQty(totals.items)} items
              </span>
              <span className="font-figures text-xl font-semibold tracking-tight">
                {formatKes(totals.total)}
              </span>
            </div>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="border-border text-muted-foreground shrink-0"
                disabled={tab.lines.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                aria-label="Clear cart"
              >
                <Trash2 className="size-4" />
              </Button>
              <Button
                className="flex-1 h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-display font-semibold"
                disabled={tab.lines.length === 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onCheckout();
                }}
              >
                Checkout {totals.total > 0 ? formatKes(totals.total) : ""}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CartLineRow({
  line,
  onQty,
  onPrice,
  onRemove,
}: {
  line: CartLine;
  onQty: (qty: number) => void;
  onPrice: (price: number) => void;
  onRemove: () => void;
}) {
  const [priceText, setPriceText] = useState<string | null>(null);
  const [qtyText, setQtyText] = useState<string | null>(null);
  const bargained = line.unitPrice !== line.listPrice;
  // Pack lines have a fixed pack price — only the pack count is editable.
  const priceEditable = !line.pack && line.allowBargain;
  const belowFloor =
    !line.pack && line.minPrice != null && line.minPrice > 0 && line.unitPrice < line.minPrice;

  return (
    <li className="px-2.5 py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium leading-snug min-w-0">
          {line.name}
          {line.pack && (
            <span className="block text-[10px] font-figures font-normal text-warning">
              {line.pack.name} × {formatQty(line.pack.units)} {line.unit}
            </span>
          )}
        </p>
        <button
          type="button"
          aria-label="Remove line"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="text-muted-foreground hover:text-destructive transition-colors cursor-pointer shrink-0"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex items-center gap-0.5">
          <QtyButton
            aria-label="Decrease quantity"
            onClick={() => onQty(Math.max(1, line.qty - 1))}
            icon={<Minus className="size-3" />}
          />
          {/* Typeable quantity — the +/- buttons still work alongside it */}
          <Input
            aria-label={`Quantity for ${line.name}`}
            className="w-12 h-6 px-1 bg-background border-input font-figures text-xs text-center"
            inputMode="decimal"
            value={qtyText ?? formatQty(line.qty)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              setQtyText(e.target.value);
              const v = parseQty(e.target.value);
              if (v !== null) onQty(v);
            }}
            onBlur={() => setQtyText(null)}
          />
          <QtyButton
            aria-label="Increase quantity"
            onClick={() => onQty(line.qty + 1)}
            icon={<Plus className="size-3" />}
          />
          {line.pack && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {line.qty === 1 ? line.pack.name : `${line.pack.name}s`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {priceEditable ? (
            <div className="relative">
              <Input
                aria-label={`Price for ${line.name}`}
                className={`w-16 h-7 font-figures text-right text-xs bg-background ${
                  belowFloor
                    ? "border-destructive text-destructive"
                    : bargained
                      ? "border-warning text-warning"
                      : "border-input"
                }`}
                inputMode="decimal"
                value={priceText ?? formatPlain(line.unitPrice)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  setPriceText(e.target.value);
                  const cents = parseKes(e.target.value);
                  if (cents !== null) onPrice(cents);
                }}
                onBlur={() => setPriceText(null)}
              />
              {bargained && (
                <span className="absolute -top-3.5 right-0 text-[9px] text-warning line-through font-figures">
                  {formatPlain(line.listPrice)}
                </span>
              )}
              {belowFloor && (
                <span className="absolute -bottom-4 right-0 text-[9px] text-destructive font-figures whitespace-nowrap">
                  min {formatPlain(line.minPrice!)}
                </span>
              )}
            </div>
          ) : (
            <span className="font-figures text-xs text-muted-foreground">
              @{formatPlain(line.unitPrice)}
            </span>
          )}
          <span className="font-figures text-[13px] font-semibold w-16 text-right">
            {formatKes(lineTotal(line))}
          </span>
        </div>
      </div>
    </li>
  );
}

/** Parse a typed quantity — decimals allowed for weighed goods (kg, litres). */
function parseQty(text: string): number | null {
  const v = parseFloat(text);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Shown the moment a product tile is tapped: the cashier picks a packaging
 * option (single units or a pack like "Crate of 30"), confirms or edits the
 * final price and the quantity before the item lands in the cart.
 * This keeps every line's price exact — with several products in one sale,
 * a single whole-cart bargain could never be attributed per product.
 * (Barcode scans skip this dialog for speed and reuse the last sold price.)
 */
function AddPriceDialog({
  product,
  onClose,
  onAdd,
}: {
  product: CatalogProduct | null;
  onClose: () => void;
  onAdd: (
    product: CatalogProduct,
    opts: {
      qty: number;
      unitPrice: number;
      pack: { id: number; name: string; units: number; price: number } | null;
    },
  ) => void;
}) {
  return (
    <Dialog open={product !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-card border-border w-[calc(100vw-1.5rem)] sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="font-display leading-snug">
            {product?.name ?? "Add product"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Confirm the packaging, price and quantity before adding to the cart
          </DialogDescription>
        </DialogHeader>
        {product && (
          <AddPriceForm key={product.id} product={product} onAdd={onAdd} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddPriceForm({
  product,
  onAdd,
}: {
  product: CatalogProduct;
  onAdd: (
    product: CatalogProduct,
    opts: {
      qty: number;
      unitPrice: number;
      pack: { id: number; name: string; units: number; price: number } | null;
    },
  ) => void;
}) {
  // null = selling single units; otherwise the selected packaging option.
  const [pack, setPack] = useState<CatalogProduct["packages"][number] | null>(null);
  const [priceText, setPriceText] = useState(() =>
    formatPlain(product.lastSoldPrice ?? product.retailPrice),
  );
  const [qtyText, setQtyText] = useState("1");

  const price = parseKes(priceText);
  const qty = parseQty(qtyText);
  const floor = product.minPrice != null && product.minPrice > 0 ? product.minPrice : null;
  // Pack prices are fixed; per-unit lines respect bargaining + the price floor.
  const priceLocked = pack !== null || !product.allowBargain;
  const effectivePrice = pack ? pack.price : priceLocked ? product.retailPrice : price;
  const belowFloor = !pack && floor !== null && effectivePrice !== null && effectivePrice < floor;
  const stockShort =
    qty !== null &&
    (pack ? qty * pack.qty > product.stockQty : qty > product.stockQty);
  const valid =
    effectivePrice !== null && effectivePrice > 0 && qty !== null && !belowFloor;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    onAdd(product, {
      qty: qty!,
      unitPrice: effectivePrice!,
      pack: pack ? { id: pack.id, name: pack.name, units: pack.qty, price: pack.price } : null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Packaging: sell single units or whole packs */}
      <div className="space-y-1.5">
        <Label>Selling as</Label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setPack(null)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
              pack === null
                ? "border-primary bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Per {product.unit} · {formatKes(product.retailPrice)}
          </button>
          {product.packages.map((pk) => (
            <button
              key={pk.id}
              type="button"
              onClick={() => setPack(pk)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                pack?.id === pk.id
                  ? "border-warning bg-warning/15 text-warning"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {pk.name} ({formatQty(pk.qty)}) · {formatKes(pk.price)}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="add-qty">
            {pack ? `${pack.name}s` : `Quantity (${product.unit})`}
          </Label>
          <Input
            id="add-qty"
            inputMode="decimal"
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            className="bg-background border-input h-12 font-figures text-lg text-center"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-price">
            {pack ? `Price per ${pack.name} (KES)` : "Last price (KES)"}
          </Label>
          <Input
            id="add-price"
            inputMode="decimal"
            autoFocus
            readOnly={priceLocked}
            value={
              pack
                ? formatPlain(pack.price)
                : priceLocked
                  ? formatPlain(product.retailPrice)
                  : priceText
            }
            onChange={(e) => setPriceText(e.target.value)}
            className={`bg-background h-12 font-figures text-lg text-right ${
              belowFloor ? "border-destructive text-destructive" : "border-input"
            }`}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground -mt-1">
        {pack
          ? `1 ${pack.name} = ${formatQty(pack.qty)} ${product.unit} — stock is deducted in ${product.unit}.`
          : priceLocked
            ? "Fixed price — bargaining is off for this product."
            : product.lastSoldPrice !== null
              ? `Prefilled with the last price this sold at (list ${formatKes(product.retailPrice)}).`
              : `List price ${formatKes(product.retailPrice)} — type the agreed price if different.`}
      </p>
      {belowFloor && (
        <p className="text-xs text-destructive -mt-1">
          Cannot sell below the minimum price of {formatKes(floor!)}.
        </p>
      )}
      {stockShort && (
        <p className="text-xs text-warning -mt-1">
          Only {formatQty(product.stockQty)} {product.unit} in stock.
        </p>
      )}
      <div className="rounded-md border border-border bg-secondary/60 px-4 py-2.5 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Line total</span>
        <span className="font-figures text-xl font-semibold">
          {valid ? formatKes(Math.round(effectivePrice! * qty!)) : "—"}
        </span>
      </div>
      <Button
        type="submit"
        disabled={!valid}
        className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
      >
        Add to cart
      </Button>
    </form>
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
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="size-6 rounded border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors cursor-pointer"
      {...rest}
    >
      {icon}
    </button>
  );
}
