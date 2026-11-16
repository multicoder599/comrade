export type CatalogProduct = {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  category: string;
  unit: string;
  buyingPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  wholesaleMinQty: number;
  lastSoldPrice: number | null;
  allowBargain: boolean;
  stockQty: number;
  shop: "A" | "B";
};

export type PriceType = "retail" | "wholesale";

export type CartLine = {
  /** `${productId}:${priceType}:${unitPrice}` — same product at two different
   * agreed prices stays on two lines, so per-product profit stays exact */
  key: string;
  productId: number;
  name: string;
  unit: string;
  qty: number;
  priceType: PriceType;
  /** actual charged unit price in cents (bargain-adjustable) */
  unitPrice: number;
  /** catalogue price for the line's price type */
  listPrice: number;
  stockQty: number;
  allowBargain: boolean;
};

export function lineKey(
  productId: number,
  priceType: PriceType,
  unitPrice?: number,
): string {
  return `${productId}:${priceType}:${unitPrice ?? "list"}`;
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
