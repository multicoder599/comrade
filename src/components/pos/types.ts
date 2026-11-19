export type CatalogPackage = {
  id: number;
  productId: number;
  /** e.g. "Crate", "Pack of 6" */
  name: string;
  /** base units in one pack (e.g. 30 eggs) */
  qty: number;
  /** cents per pack */
  price: number;
  barcode: string | null;
};

export type CatalogProduct = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  buyingPrice: number;
  retailPrice: number;
  /** lowest accepted selling price per unit (cents); null = no floor */
  minPrice: number | null;
  /** low-stock alert level for this product */
  lowStockAt: number;
  lastSoldPrice: number | null;
  allowBargain: boolean;
  stockQty: number;
  shop: "A" | "B";
  packages: CatalogPackage[];
};

export type CartLine = {
  /** `${productId}:${packId|"unit"}:${unitPrice}` — same product at two
   * different agreed prices stays on two lines, so profit stays exact */
  key: string;
  productId: number;
  name: string;
  unit: string;
  /** quantity as sold: base units for normal lines, PACKS for pack lines */
  qty: number;
  /** set when the line sells a packaging option (e.g. crate of 30) */
  pack: { id: number; name: string; units: number } | null;
  /** actual charged price in cents (per unit, or per pack for pack lines) */
  unitPrice: number;
  /** catalogue price for the line (per unit, or per pack for pack lines) */
  listPrice: number;
  /** stock available in BASE units */
  stockQty: number;
  allowBargain: boolean;
  minPrice: number | null;
};

export function lineKey(
  productId: number,
  packId: number | null,
  unitPrice?: number,
): string {
  return `${productId}:${packId ?? "unit"}:${unitPrice ?? "list"}`;
}

/** Stock a line consumes, in base units. */
export function lineBaseQty(line: CartLine): number {
  return line.pack ? line.qty * line.pack.units : line.qty;
}

/** An M-Pesa (or split) payment waiting for the customer to enter their PIN. */
export type PendingPayment = {
  saleId: number;
  receiptNo: string;
  method: "megapay" | "split";
  total: number;
  phone: string;
};

export type CartTab = {
  id: string;
  label: string;
  lines: CartLine[];
  discount: number; // cents
  pending: PendingPayment | null;
  /** transient message shown at the top of the cart (e.g. failed payment) */
  notice: string | null;
};

export const MAX_TABS = 6;

export function newTab(index: number): CartTab {
  return {
    id: `tab-${Date.now()}-${index}`,
    label: `Sale ${index}`,
    lines: [],
    discount: 0,
    pending: null,
    notice: null,
  };
}

export function lineTotal(line: CartLine): number {
  return Math.round(line.unitPrice * line.qty);
}

export function cartTotal(tab: CartTab): {
  subtotal: number;
  total: number;
  items: number;
} {
  const subtotal = tab.lines.reduce((s, l) => s + lineTotal(l), 0);
  return {
    subtotal,
    total: Math.max(0, subtotal - tab.discount),
    items: tab.lines.reduce((s, l) => s + l.qty, 0),
  };
}
