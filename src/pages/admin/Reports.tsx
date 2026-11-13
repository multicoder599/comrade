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
import { formatKes, formatQty } from "@/lib/money";
import { eatDateInputValue, eatRangeFromInputs } from "@/lib/dates";
import { Download } from "lucide-react";

export default function Reports() {
  const [fromDate, setFromDate] = useState(eatDateInputValue(6));
  const [toDate, setToDate] = useState(eatDateInputValue(0));
  const range = eatRangeFromInputs(fromDate, toDate);

  const summary = trpc.reports.summary.useQuery(range);
  const top = trpc.reports.topProducts.useQuery({ ...range, limit: 15 });

  const d = summary.data;

  function exportCsv() {
    if (!d) return;
    const lines = [
      "Day,Sales,Revenue (KES)",
      ...d.byDay.map(
        (r) => `${r.day},${r.sales},${(r.revenue / 100).toFixed(2)}`,
      ),
      "",
      `Total,${d.sales},${(d.revenue / 100).toFixed(2)}`,
      `Cost,,${(d.cost / 100).toFixed(2)}`,
      `Profit,,${(d.profit / 100).toFixed(2)}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comrade-shop-report-${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="micro-label">Performance</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            Reports
          </h1>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="bg-card border-input w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="bg-card border-input w-40"
            />
          </div>
          <Button
            variant="outline"
            className="border-border gap-1.5"
            onClick={exportCsv}
            disabled={!d}
          >
            <Download className="size-4" />
            CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={d ? formatKes(d.revenue) : "—"} />
        <Stat label="Cost of goods" value={d ? formatKes(d.cost) : "—"} />
        <Stat label="Profit" value={d ? formatKes(d.profit) : "—"} accent />
        <Stat
          label="Margin"
          value={
            d && d.revenue > 0 ? `${Math.round((d.profit / d.revenue) * 100)}%` : "—"
          }
        />
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="font-display font-semibold">Per shop</h2>
          </header>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Shop</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.shops ?? []).map((s) => (
                <TableRow key={s.shop} className="border-border">
                  <TableCell className="font-medium">Shop {s.shop}</TableCell>
                  <TableCell className="text-right font-figures">{s.sales}</TableCell>
                  <TableCell className="text-right font-figures">
                    {formatKes(s.revenue)}
                  </TableCell>
                  <TableCell className="text-right font-figures text-primary">
                    {formatKes(s.profit)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="font-display font-semibold">Payment methods</h2>
          </header>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.payments ?? []).map((p) => (
                <TableRow key={p.method} className="border-border">
                  <TableCell className="font-medium">
                    {p.method === "megapay" ? "MegaPay · M-Pesa" : "Cash"}
                  </TableCell>
                  <TableCell className="text-right font-figures">{p.sales}</TableCell>
                  <TableCell className="text-right font-figures">
                    {formatKes(p.revenue)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="font-display font-semibold">Daily trend</h2>
          </header>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Sales</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(d?.byDay ?? []).map((r) => (
                <TableRow key={r.day} className="border-border">
                  <TableCell>{r.day}</TableCell>
                  <TableCell className="text-right font-figures">{r.sales}</TableCell>
                  <TableCell className="text-right font-figures">
                    {formatKes(r.revenue)}
                  </TableCell>
                </TableRow>
              ))}
              {(d?.byDay ?? []).length === 0 && (
                <TableRow className="border-border">
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No completed sales in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="font-display font-semibold">Top products</h2>
          </header>
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(top.data ?? []).map((p) => (
                <TableRow key={p.productId} className="border-border">
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell className="text-right font-figures">
                    {formatQty(p.qty)}
                  </TableCell>
                  <TableCell className="text-right font-figures">
                    {formatKes(p.revenue)}
                  </TableCell>
                  <TableCell className="text-right font-figures text-primary">
                    {formatKes(p.profit)}
                  </TableCell>
                </TableRow>
              ))}
              {(top.data ?? []).length === 0 && (
                <TableRow className="border-border">
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    No sales in this range.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="micro-label">{label}</p>
      <p
        className={`font-figures text-xl font-semibold mt-1.5 tracking-tight ${
          accent ? "text-primary" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
