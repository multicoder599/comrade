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
import { useAuth } from "@/lib/auth";
import { errorMessage } from "@/lib/auth";
import { formatKes, formatPlain, formatQty, parseKes } from "@/lib/money";
import { Boxes, Pencil, Search } from "lucide-react";

// Cashier database page: see stock, top it up, and adjust selling prices
// (retail / wholesale) without needing the admin panel.

type Row = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  unit: string;
  retailPrice: number;
  wholesalePrice: number;
  wholesaleMinQty: number;
  stockQty: number;
};

export function CashierDbView() {
  const { user } = useAuth();
  const shop = user?.shop ?? "A";
  const [search, setSearch] = useState("");
  const [stockText, setStockText] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<Row | null>(null);
  const [retail, setRetail] = useState("");
  const [wholesale, setWholesale] = useState("");
  const [minQty, setMinQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      flash("Prices updated");
    },
    onError: (e) => setError(errorMessage(e)),
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

  function openEdit(p: Row) {
    setEditing(p);
    setRetail(formatPlain(p.retailPrice));
    setWholesale(formatPlain(p.wholesalePrice));
    setMinQty(String(p.wholesaleMinQty));
    setError(null);
  }

  function savePrices() {
    if (!editing) return;
    const retailPrice = parseKes(retail);
    const wholesalePrice = parseKes(wholesale);
    if (retailPrice === null || wholesalePrice === null) {
      setError("Enter valid prices");
      return;
    }
    updatePrices.mutate({
      id: editing.id,
      retailPrice,
      wholesalePrice,
      wholesaleMinQty: Number(minQty) || 1,
    });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4">
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
            <p className="text-sm">No products yet — the admin adds them.</p>
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
                  </div>
                  <span
                    className={`font-figures text-sm ${p.stockQty <= 5 ? "text-warning" : "text-muted-foreground"}`}
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
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap text-sm">
                  <span className="font-figures">
                    <span className="micro-label mr-1.5">Retail</span>
                    {formatKes(p.retailPrice)}
                  </span>
                  <span className="font-figures">
                    <span className="micro-label mr-1.5">Wholesale</span>
                    <span className="text-warning">
                      {formatKes(p.wholesalePrice)}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {" "}
                      min {formatQty(p.wholesaleMinQty)}
                    </span>
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
              Update retail and wholesale selling prices
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
              <Label>Wholesale price (KES)</Label>
              <Input
                inputMode="decimal"
                value={wholesale}
                onChange={(e) => setWholesale(e.target.value)}
                className="bg-background border-input font-figures"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Wholesale min qty</Label>
              <Input
                inputMode="decimal"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
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
            onClick={savePrices}
            disabled={updatePrices.isPending}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
          >
            {updatePrices.isPending ? "Saving…" : "Save prices"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
