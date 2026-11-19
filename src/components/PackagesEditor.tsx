import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, Plus, Trash2 } from "lucide-react";

// Packaging options for a product: e.g. eggs are stocked singly but can also
// sell as a "Crate" of 30 at its own price. Stock always stays in base units.

export type PackFormRow = {
  name: string;
  qty: string; // base units in one pack
  price: string; // KES per pack
  barcode: string;
};

export const EMPTY_PACK: PackFormRow = {
  name: "",
  qty: "",
  price: "",
  barcode: "",
};

export function PackagesEditor({
  packs,
  onChange,
  unit,
}: {
  packs: PackFormRow[];
  onChange: (packs: PackFormRow[]) => void;
  unit: string;
}) {
  function update(index: number, patch: Partial<PackFormRow>) {
    onChange(packs.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  return (
    <div className="col-span-2 rounded-md border border-border bg-secondary/40 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Package className="size-4 text-primary" />
        <div>
          <p className="text-sm font-semibold font-display">Product Packaging</p>
          <p className="text-[11px] text-muted-foreground">
            Optional — e.g. a crate of 30 eggs with its own price. Stock is
            still counted in {unit || "units"}.
          </p>
        </div>
      </div>
      {packs.map((p, i) => (
        <div key={i} className="rounded-md border border-border bg-card p-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">Package name *</Label>
              <Input
                value={p.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className="bg-background border-input h-8 text-sm"
                placeholder="e.g. Crate"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Quantity ({unit || "units"}) *</Label>
              <Input
                inputMode="decimal"
                value={p.qty}
                onChange={(e) => update(i, { qty: e.target.value })}
                className="bg-background border-input h-8 font-figures"
                placeholder="e.g. 30"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Selling price (KES) *</Label>
              <Input
                inputMode="decimal"
                value={p.price}
                onChange={(e) => update(i, { price: e.target.value })}
                className="bg-background border-input h-8 font-figures"
                placeholder="e.g. 450"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">Barcode (optional)</Label>
              <Input
                value={p.barcode}
                onChange={(e) => update(i, { barcode: e.target.value })}
                className="bg-background border-input h-8 font-figures"
                placeholder="Scan the pack"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange(packs.filter((_, j) => j !== i))}
            className="text-xs text-destructive hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="size-3" />
            Remove package
          </button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...packs, { ...EMPTY_PACK }])}
        className="border-dashed border-border gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-3.5" />
        Add packaging option
      </Button>
    </div>
  );
}

/** Parse editor rows into API packages; returns null + sets error on bad rows. */
export function parsePacks(
  packs: PackFormRow[],
  parseKes: (s: string) => number | null,
): { name: string; qty: number; price: number; barcode?: string }[] | null {
  const out = [];
  for (const p of packs) {
    const qty = parseFloat(p.qty);
    const price = parseKes(p.price);
    if (!p.name.trim() || !Number.isFinite(qty) || qty <= 0 || price === null) {
      return null;
    }
    out.push({
      name: p.name.trim(),
      qty,
      price,
      barcode: p.barcode.trim() || undefined,
    });
  }
  return out;
}
