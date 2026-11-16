import { useCallback, useEffect, useMemo, useState } from "react";
import { lineKey, MAX_TABS, newTab } from "./types";
import type {
  CartLine,
  CartTab,
  CatalogProduct,
  PendingPayment,
  PriceType,
} from "./types";

// Cashier tabs are kept in localStorage per shop so an accidental refresh
// never loses an in-progress sale.

type StoredLine = Partial<CartLine> & {
  productId: number;
  qty: number;
  unitPrice: number;
  listPrice: number;
};
type StoredTab = Partial<CartTab> & {
  id: string;
  label: string;
  mode?: "retail" | "wholesale"; // legacy field, folded into line priceType
};

function normalizeTab(raw: StoredTab, index: number): CartTab {
  const defaultType: PriceType = raw.mode === "wholesale" ? "wholesale" : "retail";
  const lines: CartLine[] = (Array.isArray(raw.lines) ? raw.lines : []).map(
    (l: StoredLine) => {
      const priceType: PriceType =
        l.priceType === "wholesale" ? "wholesale" : defaultType;
      return {
        key: l.key ?? lineKey(l.productId, priceType, l.unitPrice),
        productId: l.productId,
        name: l.name ?? "",
        unit: l.unit ?? "pc",
        qty: l.qty,
        priceType,
        unitPrice: l.unitPrice,
        listPrice: l.listPrice,
        stockQty: l.stockQty ?? 0,
        allowBargain: l.allowBargain ?? true,
      };
    },
  );
  return {
    id: raw.id,
    label: raw.label ?? `Sale ${index + 1}`,
    lines,
    discount: raw.discount ?? 0,
    pending: raw.pending ?? null,
    notice: null,
  };
}

export function useCartTabs(shop: "A" | "B") {
  const storageKey = `comrade_tabs_${shop}`;
  const [tabs, setTabs] = useState<CartTab[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { tabs: StoredTab[] };
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          return parsed.tabs.slice(0, MAX_TABS).map(normalizeTab);
        }
      }
    } catch {
      /* corrupted state — start fresh */
    }
    return [newTab(1)];
  });
  const [activeId, setActiveId] = useState<string>(tabs[0].id);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ tabs }));
  }, [tabs, storageKey]);

  const active = useMemo(
    () => tabs.find((t) => t.id === activeId) ?? tabs[0],
    [tabs, activeId],
  );

  const updateTab = useCallback(
    (id: string, updater: (tab: CartTab) => CartTab) => {
      setTabs((prev) => prev.map((t) => (t.id === id ? updater(t) : t)));
    },
    [],
  );

  const addTab = useCallback(() => {
    const tab = newTab(Date.now() % 100000);
    setTabs((prev) => {
      if (prev.length >= MAX_TABS) return prev;
      return [...prev, { ...tab, label: `Sale ${prev.length + 1}` }];
    });
    setActiveId(tab.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      if (id === activeId) {
        const remaining = tabs.filter((t) => t.id !== id);
        if (remaining.length > 0) {
          setActiveId(remaining[remaining.length - 1].id);
        }
      }
      setTabs((prev) => {
        if (prev.length === 1) return [newTab(1)];
        return prev
          .filter((t) => t.id !== id)
          .map((t, i) => ({ ...t, label: `Sale ${i + 1}` }));
      });
    },
    [activeId, tabs],
  );

  const addProduct = useCallback(
    (
      product: CatalogProduct,
      opts: { priceType?: PriceType; qty?: number; unitPrice?: number } = {},
    ) => {
      const priceType = opts.priceType ?? "retail";
      updateTab(active.id, (tab) => {
        if (tab.pending) return tab; // locked while waiting for payment
        const listPrice =
          priceType === "retail" ? product.retailPrice : product.wholesalePrice;
        const unitPrice = opts.unitPrice ?? product.lastSoldPrice ?? listPrice;
        const qty = opts.qty ?? 1;
        // Lines are keyed by price too: the same product at two different
        // agreed prices becomes two lines, never a merged average.
        const key = lineKey(product.id, priceType, unitPrice);
        const existing = tab.lines.find((l) => l.key === key);
        if (existing) {
          return {
            ...tab,
            notice: null,
            lines: tab.lines.map((l) =>
              l.key === key ? { ...l, qty: l.qty + qty } : l,
            ),
          };
        }
        const line: CartLine = {
          key,
          productId: product.id,
          name: product.name,
          unit: product.unit,
          qty,
          priceType,
          unitPrice,
          listPrice,
          stockQty: product.stockQty,
          allowBargain: product.allowBargain,
        };
        return { ...tab, notice: null, lines: [...tab.lines, line] };
      });
    },
    [active.id, updateTab],
  );

  /** Flip a line between retail and wholesale pricing (re-priced to list). */
  const setLinePriceType = useCallback(
    (key: string, priceType: PriceType, catalog: CatalogProduct[]) => {
      updateTab(active.id, (tab) => {
        const line = tab.lines.find((l) => l.key === key);
        if (!line || line.priceType === priceType) return tab;
        const p = catalog.find((c) => c.id === line.productId);
        if (!p) return tab;
        const listPrice =
          priceType === "retail" ? p.retailPrice : p.wholesalePrice;
        // Flipping price type re-prices to the list price, so the key uses it.
        const newKey = lineKey(line.productId, priceType, listPrice);
        const mergeTarget = tab.lines.find((l) => l.key === newKey);
        if (mergeTarget) {
          // Same product already present at that price type — merge quantities.
          return {
            ...tab,
            lines: tab.lines
              .filter((l) => l.key !== key)
              .map((l) =>
                l.key === newKey ? { ...l, qty: l.qty + line.qty } : l,
              ),
          };
        }
        return {
          ...tab,
          lines: tab.lines.map((l) =>
            l.key === key
              ? { ...l, key: newKey, priceType, listPrice, unitPrice: listPrice }
              : l,
          ),
        };
      });
    },
    [active.id, updateTab],
  );

  const updateLine = useCallback(
    (key: string, patch: Partial<CartLine>) => {
      updateTab(active.id, (tab) => ({
        ...tab,
        lines: tab.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)),
      }));
    },
    [active.id, updateTab],
  );

  const removeLine = useCallback(
    (key: string) => {
      updateTab(active.id, (tab) => ({
        ...tab,
        lines: tab.lines.filter((l) => l.key !== key),
      }));
    },
    [active.id, updateTab],
  );

  /** Empty a tab after its sale completes (works on any tab, not just active). */
  const clearTab = useCallback(
    (id: string) => {
      updateTab(id, (t) => ({
        ...newTab(1),
        id: t.id,
        label: t.label,
      }));
    },
    [updateTab],
  );

  const clearActive = useCallback(() => {
    clearTab(active.id);
  }, [active.id, clearTab]);

  const setPending = useCallback(
    (id: string, pending: PendingPayment | null) => {
      updateTab(id, (t) => ({ ...t, pending }));
    },
    [updateTab],
  );

  const setNotice = useCallback(
    (id: string, notice: string | null) => {
      updateTab(id, (t) => ({ ...t, notice }));
    },
    [updateTab],
  );

  return {
    tabs,
    active,
    activeId,
    setActiveId,
    addTab,
    closeTab,
    addProduct,
    setLinePriceType,
    updateLine,
    removeLine,
    clearActive,
    clearTab,
    setPending,
    setNotice,
    updateTab,
  };
}
