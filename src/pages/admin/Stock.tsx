import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { formatQty } from "@/lib/money";
import { useMemo } from "react";

export default function Stock() {
  const listQuery = trpc.products.listAll.useQuery({});
  const adjust = trpc.products.adjustStock.useMutation({
    onSuccess: () => listQuery.refetch(),
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  async function applyAdjust(
    productId: number,
    name: string,
    shop: "A" | "B",
    deltaText: string,
  ) {
    const delta = Number(deltaText);
    if (!deltaText || !Number.isFinite(delta) || delta === 0) return;
    try {
      await adjust.mutateAsync({ productId, shop, delta });
      setFeedback(`${name} — Shop ${shop} stock updated`);
    } catch (err) {
      setFeedback(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="micro-label">Inventory</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Stock</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add quantities when new stock arrives (e.g. +24), or enter a negative
          number to correct shrinkage.
        </p>
      </div>

      {feedback && (
        <p className="text-sm text-primary" role="status">
          {feedback}
        </p>
      )}

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Shop A</TableHead>
              <TableHead className="w-44">Add / remove (A)</TableHead>
              <TableHead className="text-right">Shop B</TableHead>
              <TableHead className="w-44">Add / remove (B)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows
              .filter((p) => p.active)
              .map((p) => (
                <StockRow
                  key={p.id}
                  product={p}
                  busy={adjust.isPending}
                  onApply={applyAdjust}
                />
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function StockRow({
  product,
  busy,
  onApply,
}: {
  product: {
    id: number;
    name: string;
    sku: string;
    unit: string;
    stockA: number;
    stockB: number;
  };
  busy: boolean;
  onApply: (id: number, name: string, shop: "A" | "B", delta: string) => void;
}) {
  const [deltaA, setDeltaA] = useState("");
  const [deltaB, setDeltaB] = useState("");

  return (
    <TableRow className="border-border">
      <TableCell>
        <p className="font-medium">{product.name}</p>
        <p className="text-xs text-muted-foreground">
          {product.sku} · per {product.unit}
        </p>
      </TableCell>
      <TableCell
        className={`text-right font-figures font-semibold ${
          product.stockA <= 5 ? "text-warning" : ""
        }`}
      >
        {formatQty(product.stockA)}
      </TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Input
            inputMode="numeric"
            placeholder="+0"
            value={deltaA}
            onChange={(e) => setDeltaA(e.target.value)}
            className="h-8 bg-background border-input font-figures"
          />
          <Button
            size="sm"
            variant="outline"
            className="border-border h-8"
            disabled={busy || !deltaA}
            onClick={() => {
              onApply(product.id, product.name, "A", deltaA);
              setDeltaA("");
            }}
          >
            Apply
          </Button>
        </div>
      </TableCell>
      <TableCell
        className={`text-right font-figures font-semibold ${
          product.stockB <= 5 ? "text-warning" : ""
        }`}
      >
        {formatQty(product.stockB)}
      </TableCell>
      <TableCell>
        <div className="flex gap-1.5">
          <Input
            inputMode="numeric"
            placeholder="+0"
            value={deltaB}
            onChange={(e) => setDeltaB(e.target.value)}
            className="h-8 bg-background border-input font-figures"
          />
          <Button
            size="sm"
            variant="outline"
            className="border-border h-8"
            disabled={busy || !deltaB}
            onClick={() => {
              onApply(product.id, product.name, "B", deltaB);
              setDeltaB("");
            }}
          >
            Apply
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
