import { useCallback, useEffect, useMemo, useState } from "react";
import { lineKey, MAX_TABS, newTab } from "./types";
import type {
  CartLine,
  CartTab,
  CatalogProduct,
  PendingPayment,
} from "./types";

// Cashier tabs are kept in localStorage per shop so an accidental refresh
// never loses an in-progress sale.

type StoredLine = Partial<CartLine> & {
  productId: number;
  qty: number;
  unitPrice: number;
  listPrice: number;
  /** pre-1.7 lines had a retail/wholesale price type — folded into the key */
  priceType?: "retail" | "wholesale";
};
type StoredTab = Partial<CartTab> & {
  id: string;
  label: string;
  mode?: "retail" | "wholesale"; // legacy field, dropped in 1.7
};

function normalizeTab(raw: StoredTab, index: number): CartTab {
  const lines: CartLine[] = (Array.isArray(raw.lines) ? raw.lines : []).map(
    (l: StoredLine) => {
      const pack = l.pack ?? null;
      return {
        key: l.key ?? lineKey(l.productId, pack?.id ?? null, l.unitPrice),
        productId: l.productId,
        name: l.name ?? "",
        unit: l.unit ?? "pc",
        qty: l.qty,
        pack,
        unitPrice: l.unitPrice,
        listPrice: l.listPrice,
        stockQty: l.stockQty ?? 0,
        allowBargain: l.allowBargain ?? true,
        minPrice: l.minPrice ?? null,
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
      opts: {
        qty?: number;
        unitPrice?: number;
        pack?: { id: number; name: string; units: number; price: number } | null;
      } = {},
    ) => {
      const pack = opts.pack ?? null;
      updateTab(active.id, (tab) => {
        if (tab.pending) return tab; // locked while waiting for payment
        const listPrice = pack ? pack.price : product.retailPrice;
        // Pack prices are fixed; per-unit lines prefill the last sold price,
        // never below the product's price floor.
        let unitPrice = pack
          ? pack.price
          : (opts.unitPrice ?? product.lastSoldPrice ?? listPrice);
        if (product.minPrice != null && product.minPrice > 0) {
          unitPrice = Math.max(unitPrice, product.minPrice);
        }
        const qty = opts.qty ?? 1;
        // Lines are keyed by pack + price: the same product at two different
        // agreed prices becomes two lines, never a merged average.
        const key = lineKey(product.id, pack?.id ?? null, unitPrice);
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
          pack: pack ? { id: pack.id, name: pack.name, units: pack.units } : null,
          unitPrice,
          listPrice,
          stockQty: product.stockQty,
          allowBargain: product.allowBargain,
          minPrice: product.minPrice,
        };
        return { ...tab, notice: null, lines: [...tab.lines, line] };
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
    updateLine,
    removeLine,
    clearActive,
    clearTab,
    setPending,
    setNotice,
    updateTab,
  };
}
