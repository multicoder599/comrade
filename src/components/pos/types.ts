export type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  buyingPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  wholesaleMinQty: number;
  allowBargain: boolean;
  stockQty: number;
  shop: "A" | "B";
};

export type CartLine = {
  productId: number;
  name: string;
  unit: string;
  qty: number;
  /** actual charged unit price in cents (bargain-adjustable) */
  unitPrice: number;
  /** catalogue price for the current sale mode */
  listPrice: number;
  stockQty: number;
  allowBargain: boolean;
};

export type CartTab = {
  id: string;
  label: string;
  mode: "retail" | "wholesale";
  lines: CartLine[];
  customerName: string;
  discount: number; // cents
};

export const MAX_TABS = 4;

export function newTab(index: number): CartTab {
  return {
    id: `tab-${Date.now()}-${index}`,
    label: `Sale ${index}`,
    mode: "retail",
    lines: [],
    customerName: "",
    discount: 0,
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
