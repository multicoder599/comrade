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
import { trpc } from "@/providers/trpc";
import { CategorySelect } from "@/components/CategorySelect";
import {
  PackagesEditor,
  parsePacks,
  type PackFormRow,
} from "@/components/PackagesEditor";
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { ArrowRightLeft, Boxes, Pencil, Plus, ScanBarcode, Search } from "lucide-react";

// Cashier database page: create products, top up stock, transfer stock to the
// other shop, and adjust selling prices / price floor / low-stock level
// without needing the admin panel.

type Row = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  retailPrice: number;
  minPrice: number | null;
  lowStockAt: number;
  stockQty: number;
  packages: {
    id: number;
    productId: number;
    name: string;
    qty: number;
    price: number;
    barcode: string | null;
  }[];
};

export function CashierDbView() {
  const { user } = useAuth();
  const shop = user?.shop ?? "A";
  const otherShop = shop === "A" ? "B" : "A";
  const [search, setSearch] = useState("");
  const [stockText, setStockText] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [retail, setRetail] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [lowStockAt, setLowStockAt] = useState("5");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Row | null>(null);
  const [transferQty, setTransferQty] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState({
    name: "",
    code: "",
    category: "",
    unit: "pc",
    retail: "",
    minPrice: "",
    buying: "",
    stock: "",
    lowStockAt: "5",
  });
  const [newPacks, setNewPacks] = useState<PackFormRow[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const listQuery = trpc.products.listForShop.useQuery({ shop });
  const adjustStock = trpc.products.adjustStock.useMutation({
    onSuccess: (_r, vars) => {
      listQuery.refetch();
      setStockText((s) => ({ ...s, [vars.productId]: "" }));
      flash("Stock updated");
    },
    onError: (e) => flash(errorMessage(e)),
  });
  const updatePrices = trpc.products.updatePrices.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setEditing(null);
      flash("Product updated");
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const transferStock = trpc.products.transfer.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setTransfer(null);
      setTransferQty("");
      flash(`Stock moved to Shop ${otherShop}`);
    },
    onError: (e) => setTransferError(errorMessage(e)),
  });
  const createProduct = trpc.products.cashierCreate.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setNewProduct({
        name: "",
        code: "",
        category: "",
        unit: "pc",
        retail: "",
        minPrice: "",
        buying: "",
        stock: "",
        lowStockAt: "5",
      });
      setNewPacks([]);
      setCreateError(null);
      flash("Product created");
    },
    onError: (e) => setCreateError(errorMessage(e)),
  });

  function flash(message: string) {
    setNotice(message);
    setTimeout(() => setNotice(null), 3000);
  }

  const rows = ((listQuery.data ?? []) as Row[]).filter((p) => {
    const term = search.trim().toLowerCase();
    return (
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      (p.barcode ?? "").toLowerCase().includes(term)
    );
  });
  const categories = [
    ...new Set((listQuery.data ?? []).map((p) => p.category)),
  ].sort();

  function submitNewProduct() {
    const retailPrice = parseKes(newProduct.retail);
    const min = newProduct.minPrice.trim() ? parseKes(newProduct.minPrice) : null;
    const buyingPrice = newProduct.buying.trim()
      ? parseKes(newProduct.buying)
      : 0;
    const lowStockAt = newProduct.lowStockAt.trim()
      ? Number(newProduct.lowStockAt)
      : 5;
    if (!newProduct.name.trim() || !newProduct.code.trim()) {
      setCreateError("Name and barcode/SKU are required");
      return;
    }
    if (retailPrice === null || retailPrice <= 0) {
      setCreateError("Enter a valid retail price");
      return;
    }
    if (newProduct.minPrice.trim() && min === null) {
      setCreateError("Enter a valid minimum price, or leave it empty");
      return;
    }
    if (buyingPrice === null || !Number.isFinite(lowStockAt) || lowStockAt < 0) {
      setCreateError("Enter valid numbers (or leave the optional ones empty)");
      return;
    }
    const packages = parsePacks(newPacks, parseKes);
    if (packages === null) {
      setCreateError("Every package needs a name, a quantity and a selling price");
      return;
    }
    createProduct.mutate({
      name: newProduct.name.trim(),
      code: newProduct.code.trim(),
      category: newProduct.category.trim() || "General",
      unit: newProduct.unit.trim() || "pc",
      retailPrice,
      minPrice: min,
      lowStockAt,
      packages,
      buyingPrice,
      initialStock: Number(newProduct.stock) || 0,
    });
  }

  function openEdit(p: Row) {
    setEditing(p);
    setRetail(formatPlain(p.retailPrice));
    setMinPrice(p.minPrice !== null ? formatPlain(p.minPrice) : "");
    setLowStockAt(String(p.lowStockAt));
    setError(null);
  }

  function savePrices() {
    if (!editing) return;
    const retailPrice = parseKes(retail);
    const min = minPrice.trim() ? parseKes(minPrice) : null;
    const lowStock = Number(lowStockAt);
    if (retailPrice === null) {
      setError("Enter a valid retail price");
      return;
    }
    if (minPrice.trim() && min === null) {
      setError("Enter a valid minimum price, or leave it empty");
      return;
    }
    if (!Number.isFinite(lowStock) || lowStock < 0) {
      setError("Enter a valid low stock level");
      return;
    }
    updatePrices.mutate({
      id: editing.id,
      retailPrice,
      minPrice: min,
      lowStockAt: lowStock,
    });
  }

  function submitTransfer() {
    if (!transfer) return;
    const qty = Number(transferQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setTransferError("Enter how many to transfer");
      return;
    }
    if (qty > transfer.stockQty) {
      setTransferError(`Only ${formatQty(transfer.stockQty)} ${transfer.unit} in stock here`);
      return;
    }
    setTransferError(null);
    transferStock.mutate({ productId: transfer.id, from: shop, qty });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full max-w-6xl p-4 md:p-6 space-y-4">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <p className="micro-label">Shop {shop}</p>
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              Database
            </h1>
          </div>
          {notice && (
            <p className="text-sm text-success font-medium">{notice}</p>
          )}
        </div>

        {/* Add new product — only name, code and retail price are required */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="micro-label flex items-center gap-1.5">
            <Plus className="size-3.5" /> Add new product
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <Input
              placeholder="Product name, e.g. Bread"
              value={newProduct.name}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, name: e.target.value }))
              }
              className="col-span-2 bg-background border-input h-9 text-sm"
            />
            <div className="relative">
              <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-primary" />
              <Input
                placeholder="Barcode / SKU"
                value={newProduct.code}
                onChange={(e) =>
                  setNewProduct((s) => ({ ...s, code: e.target.value }))
                }
                className="pl-8 bg-background border-input h-9 text-sm font-figures"
              />
            </div>
            <CategorySelect
              value={newProduct.category}
              categories={categories}
              onChange={(category) =>
                setNewProduct((s) => ({ ...s, category }))
              }
              className="bg-background border-input h-9 text-sm"
            />
            <Input
              placeholder="Unit (pc / kg)"
              value={newProduct.unit}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, unit: e.target.value }))
              }
              className="bg-background border-input h-9 text-sm"
            />
            <Input
              placeholder="Retail price (KES)"
              inputMode="decimal"
              value={newProduct.retail}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, retail: e.target.value }))
              }
              className="bg-background border-input h-9 text-sm font-figures"
            />
            <Input
              placeholder="Min selling price (optional)"
              inputMode="decimal"
              value={newProduct.minPrice}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, minPrice: e.target.value }))
              }
              className="bg-background border-input h-9 text-sm font-figures"
            />
            <Input
              placeholder="Buying price (optional)"
              inputMode="decimal"
              value={newProduct.buying}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, buying: e.target.value }))
              }
              className="bg-background border-input h-9 text-sm font-figures"
            />
            <Input
              placeholder="Opening stock qty"
              inputMode="decimal"
              value={newProduct.stock}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, stock: e.target.value }))
              }
              className="bg-background border-input h-9 text-sm font-figures"
            />
            <Input
              placeholder="Low stock alert at (5)"
              inputMode="decimal"
              value={newProduct.lowStockAt}
              onChange={(e) =>
                setNewProduct((s) => ({ ...s, lowStockAt: e.target.value }))
              }
              className="bg-background border-input h-9 text-sm font-figures"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <PackagesEditor
              packs={newPacks}
              onChange={setNewPacks}
              unit={newProduct.unit.trim() || "pc"}
            />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {createError ? (
              <p className="text-xs text-destructive" role="alert">
                {createError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Category, min price, buying price & packaging are optional — set
                the buying price now so profit counts correctly, or the admin can
                set it later.
              </p>
            )}
            <Button
              size="sm"
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              disabled={
                createProduct.isPending ||
                !newProduct.name.trim() ||
                !newProduct.code.trim() ||
                !newProduct.retail.trim()
              }
              onClick={submitNewProduct}
            >
              <Plus className="size-4 mr-1" />
              {createProduct.isPending ? "Adding…" : "Add product"}
            </Button>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, SKU or barcode…"
            className="pl-9 bg-card border-input h-9 text-sm"
          />
        </div>

        {listQuery.isLoading ? (
          <p className="text-sm text-muted-foreground py-6">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-10 text-center text-muted-foreground">
            <Boxes className="size-6 mx-auto mb-2" strokeWidth={1.5} />
            <p className="text-sm">No products yet — add your first one above.</p>
          </div>
        ) : (
          <ul className="rounded-lg border border-border bg-card divide-y divide-border overflow-hidden">
            {rows.map((p) => (
              <li key={p.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku}
                      {p.barcode ? ` · ⌗${p.barcode}` : ""} · per {p.unit}
                    </p>
                    {p.packages.length > 0 && (
                      <p className="text-[10px] font-figures text-warning">
                        {p.packages
                          .map((pk) => `${pk.name} ×${formatQty(pk.qty)} @ ${formatKes(pk.price)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <span
                    className={`font-figures text-sm ${p.stockQty <= p.lowStockAt ? "text-warning" : "text-muted-foreground"}`}
                  >
                    {formatQty(p.stockQty)} {p.unit} in stock
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Input
                      inputMode="decimal"
                      placeholder="+0"
                      value={stockText[p.id] ?? ""}
                      onChange={(e) =>
                        setStockText((s) => ({ ...s, [p.id]: e.target.value }))
                      }
                      className="w-20 h-8 bg-background border-input font-figures text-right text-sm"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border h-8"
                      disabled={
                        adjustStock.isPending ||
                        !(Number(stockText[p.id]) > 0)
                      }
                      onClick={() =>
                        adjustStock.mutate({
                          productId: p.id,
                          shop,
                          delta: Number(stockText[p.id]),
                        })
                      }
                    >
                      Add
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-border h-8 gap-1"
                      disabled={p.stockQty <= 0}
                      title={`Move stock to Shop ${otherShop}`}
                      onClick={() => {
                        setTransfer(p);
                        setTransferQty("");
                        setTransferError(null);
                      }}
                    >
                      <ArrowRightLeft className="size-3.5" />
                      Transfer
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-sm">
                  <span className="font-figures">
                    <span className="micro-label mr-1.5">Retail</span>
                    {formatKes(p.retailPrice)}
                  </span>
                  <span className="font-figures">
                    <span className="micro-label mr-1.5">Min</span>
                    {p.minPrice !== null && p.minPrice > 0 ? (
                      formatKes(p.minPrice)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-muted-foreground hover:text-foreground gap-1 ml-auto"
                    onClick={() => openEdit(p)}
                  >
                    <Pencil className="size-3.5" />
                    Edit prices
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              Edit prices — {editing?.name}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Update the selling price, minimum price and low-stock level
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Retail price (KES)</Label>
              <Input
                inputMode="decimal"
                value={retail}
                onChange={(e) => setRetail(e.target.value)}
                className="bg-background border-input font-figures"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minimum selling price (KES)</Label>
              <Input
                inputMode="decimal"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="bg-background border-input font-figures"
                placeholder="Optional — leave empty for no floor"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Low stock alert at</Label>
              <Input
                inputMode="decimal"
                value={lowStockAt}
                onChange={(e) => setLowStockAt(e.target.value)}
                className="bg-background border-input font-figures"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            The till refuses to sell below the minimum price. Packaging options
            are managed by the admin.
          </p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            onClick={savePrices}
            disabled={updatePrices.isPending}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {updatePrices.isPending ? "Saving…" : "Save prices"}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Stock transfer to the other shop */}
      <Dialog open={transfer !== null} onOpenChange={(o) => !o && setTransfer(null)}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">
              Transfer — {transfer?.name}
            </DialogTitle>
            <DialogDescription>
              Move stock from Shop {shop} to Shop {otherShop}. It is subtracted
              here and added there immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>
              Quantity to move ({transfer?.unit}) — {formatQty(transfer?.stockQty ?? 0)}{" "}
              available
            </Label>
            <Input
              inputMode="decimal"
              autoFocus
              value={transferQty}
              onChange={(e) => setTransferQty(e.target.value)}
              className="bg-background border-input h-11 font-figures text-lg"
              placeholder="e.g. 3"
            />
          </div>
          {transferError && (
            <p className="text-sm text-destructive" role="alert">
              {transferError}
            </p>
          )}
          <Button
            onClick={submitTransfer}
            disabled={transferStock.isPending}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {transferStock.isPending
              ? "Transferring…"
              : `Move to Shop ${otherShop}`}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
