import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { CategorySelect } from "@/components/CategorySelect";
import {
  PackagesEditor,
  parsePacks,
  type PackFormRow,
} from "@/components/PackagesEditor";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { Plus, Pencil, Search, Trash2 } from "lucide-react";

type ProductRow = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  buyingPrice: number;
  retailPrice: number;
  minPrice: number | null;
  lowStockAt: number;
  lastSoldPrice: number | null;
  allowBargain: boolean;
  active: boolean;
  stockA: number;
  stockB: number;
  packages: {
    id: number;
    productId: number;
    name: string;
    qty: number;
    price: number;
    barcode: string | null;
  }[];
};

type FormState = {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  buyingPrice: string;
  retailPrice: string;
  minPrice: string;
  lowStockAt: string;
  allowBargain: boolean;
  packages: PackFormRow[];
};

const EMPTY_FORM: FormState = {
  sku: "",
  barcode: "",
  name: "",
  category: "General",
  unit: "pc",
  buyingPrice: "",
  retailPrice: "",
  minPrice: "",
  lowStockAt: "5",
  allowBargain: true,
  packages: [],
};

export default function Products() {
  const [search, setSearch] = useState("");
  const listQuery = trpc.products.listAll.useQuery(
    { search: search || undefined },
    { placeholderData: (prev) => prev },
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const create = trpc.products.create.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setDialogOpen(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const update = trpc.products.update.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setDialogOpen(false);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = trpc.products.delete.useMutation({
    onSuccess: () => listQuery.refetch(),
  });

  function deleteProduct(p: ProductRow) {
    if (
      window.confirm(
        `Delete "${p.name}" permanently? Its stock records are removed too. Past receipts keep their own copy of the sale.`,
      )
    ) {
      remove.mutate({ id: p.id });
    }
  }

  const rows = useMemo(
    () => (listQuery.data ?? []) as ProductRow[],
    [listQuery.data],
  );
  const categories = useMemo(
    () => [...new Set(rows.map((p) => p.category))].sort(),
    [rows],
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditing(p);
    setForm({
      sku: p.sku,
      barcode: p.barcode ?? "",
      name: p.name,
      category: p.category,
      unit: p.unit,
      buyingPrice: formatPlain(p.buyingPrice),
      retailPrice: formatPlain(p.retailPrice),
      minPrice: p.minPrice !== null ? formatPlain(p.minPrice) : "",
      lowStockAt: String(p.lowStockAt),
      allowBargain: p.allowBargain,
      packages: p.packages.map((pk) => ({
        name: pk.name,
        qty: formatQty(pk.qty),
        price: formatPlain(pk.price),
        barcode: pk.barcode ?? "",
      })),
    });
    setError(null);
    setDialogOpen(true);
  }

  function save() {
    const buyingPrice = parseKes(form.buyingPrice);
    const retailPrice = parseKes(form.retailPrice);
    // Optional: the lowest price the till accepts for this product.
    const minPrice = form.minPrice.trim() === "" ? null : parseKes(form.minPrice);
    const lowStockAt = form.lowStockAt.trim() === "" ? 5 : Number(form.lowStockAt);
    if (!form.sku.trim() || !form.name.trim()) {
      setError("SKU and name are required");
      return;
    }
    if (buyingPrice === null || retailPrice === null) {
      setError("Enter valid prices");
      return;
    }
    if (form.minPrice.trim() !== "" && minPrice === null) {
      setError("Enter a valid minimum price, or leave it empty");
      return;
    }
    if (!Number.isFinite(lowStockAt) || lowStockAt < 0) {
      setError("Enter a valid low stock level");
      return;
    }
    const packages = parsePacks(form.packages, parseKes);
    if (packages === null) {
      setError("Every package needs a name, a quantity and a selling price");
      return;
    }
    const payload = {
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || undefined,
      name: form.name.trim(),
      category: form.category.trim() || "General",
      unit: form.unit.trim() || "pc",
      buyingPrice,
      retailPrice,
      minPrice,
      lowStockAt,
      allowBargain: form.allowBargain,
      packages,
    };
    setError(null);
    if (editing) {
      update.mutate({ id: editing.id, ...payload });
    } else {
      create.mutate(payload);
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="micro-label">Catalogue</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Products &amp; prices
          </h1>
        </div>
        <Button
          onClick={openCreate}
          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-1.5"
        >
          <Plus className="size-4" />
          New product
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, SKU or barcode…"
          className="pl-9 bg-card border-input"
        />
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Buying</TableHead>
              <TableHead className="text-right">Retail</TableHead>
              <TableHead className="text-right">Min price</TableHead>
              <TableHead className="text-right">Last sold</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-center">Bargain</TableHead>
              <TableHead className="text-right">Stock A</TableHead>
              <TableHead className="text-right">Stock B</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const margin = p.retailPrice - p.buyingPrice;
              return (
                <TableRow key={p.id} className="border-border">
                  <TableCell>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.sku}
                      {p.barcode ? ` · ⌗${p.barcode}` : ""} · {p.category} · per{" "}
                      {p.unit}
                    </p>
                    {p.packages.length > 0 && (
                      <p className="text-[10px] font-figures text-warning">
                        {p.packages
                          .map((pk) => `${pk.name} ×${formatQty(pk.qty)} @ ${formatKes(pk.price)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-figures text-muted-foreground">
                    {formatKes(p.buyingPrice)}
                  </TableCell>
                  <TableCell className="text-right font-figures">
                    {formatKes(p.retailPrice)}
                  </TableCell>
                  <TableCell className="text-right font-figures">
                    {p.minPrice !== null && p.minPrice > 0 ? (
                      formatKes(p.minPrice)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    <span className="block text-[10px] text-muted-foreground">
                      low stock at {formatQty(p.lowStockAt)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-figures">
                    {p.lastSoldPrice !== null ? (
                      <>
                        {formatKes(p.lastSoldPrice)}
                        {p.lastSoldPrice !== p.retailPrice && (
                          <span className="block text-[10px] text-warning">
                            bargained
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right font-figures ${margin >= 0 ? "text-primary" : "text-destructive"}`}
                  >
                    {formatKes(margin)}
                  </TableCell>
                  <TableCell className="text-center">
                    {p.allowBargain ? (
                      <span className="text-warning text-xs font-medium">YES</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">fixed</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right font-figures ${p.stockA <= p.lowStockAt ? "text-warning" : ""}`}
                  >
                    {formatQty(p.stockA)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-figures ${p.stockB <= p.lowStockAt ? "text-warning" : ""}`}
                  >
                    {formatQty(p.stockB)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={p.active}
                      onCheckedChange={(active) =>
                        update.mutate({ id: p.id, active })
                      }
                      aria-label={`Toggle ${p.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(p)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteProduct(p)}
                        disabled={remove.isPending}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow className="border-border">
                <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                  No products found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-border sm:max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editing ? `Edit ${editing.name}` : "New product"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Set prices and details for this product
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>SKU / code</Label>
              <Input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="bg-background border-input"
                placeholder="e.g. SUGAR1KG"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Barcode (optional)</Label>
              <Input
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                className="bg-background border-input font-figures"
                placeholder="Scan or type it"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category (optional)</Label>
              <CategorySelect
                value={form.category}
                categories={categories}
                onChange={(category) => setForm({ ...form, category })}
                className="bg-background border-input"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="bg-background border-input"
                placeholder="e.g. Sugar 1kg"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Input
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="bg-background border-input"
                placeholder="pc / kg / litre"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Buying price (KES)</Label>
              <Input
                inputMode="decimal"
                value={form.buyingPrice}
                onChange={(e) => setForm({ ...form, buyingPrice: e.target.value })}
                className="bg-background border-input font-figures"
                placeholder="145"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Retail selling price (KES)</Label>
              <Input
                inputMode="decimal"
                value={form.retailPrice}
                onChange={(e) => setForm({ ...form, retailPrice: e.target.value })}
                className="bg-background border-input font-figures"
                placeholder="165"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minimum selling price (KES, optional)</Label>
              <Input
                inputMode="decimal"
                value={form.minPrice}
                onChange={(e) => setForm({ ...form, minPrice: e.target.value })}
                className="bg-background border-input font-figures"
                placeholder="Till refuses anything below this"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Low stock alert at</Label>
              <Input
                inputMode="decimal"
                value={form.lowStockAt}
                onChange={(e) => setForm({ ...form, lowStockAt: e.target.value })}
                className="bg-background border-input font-figures"
                placeholder="5"
              />
            </div>
            <div className="flex items-center gap-2.5 pt-6">
              <Switch
                id="allow-bargain"
                checked={form.allowBargain}
                onCheckedChange={(allowBargain) => setForm({ ...form, allowBargain })}
              />
              <Label htmlFor="allow-bargain" className="cursor-pointer">
                Allow price bargaining
              </Label>
            </div>
            <PackagesEditor
              packs={form.packages}
              onChange={(packages) => setForm({ ...form, packages })}
              unit={form.unit.trim() || "pc"}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button
            onClick={save}
            disabled={busy}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {busy ? "Saving…" : editing ? "Save changes" : "Create product"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
