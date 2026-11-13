import { useCallback, useEffect, useMemo, useState } from "react";
import { MAX_TABS, newTab } from "./types";
import type { CartLine, CartTab, CatalogProduct } from "./types";

// Cashier tabs are kept in localStorage per shop so an accidental refresh
// never loses an in-progress sale.

export function useCartTabs(shop: "A" | "B") {
  const storageKey = `comrade_tabs_${shop}`;
  const [tabs, setTabs] = useState<CartTab[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { tabs: CartTab[] };
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          return parsed.tabs.slice(0, MAX_TABS);
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
    if (tabs.length >= MAX_TABS) return;
    const tab = newTab(tabs.length + 1);
    setTabs((prev) => (prev.length >= MAX_TABS ? prev : [...prev, tab]));
    setActiveId(tab.id);
  }, [tabs.length]);

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
    (product: CatalogProduct) => {
      updateTab(active.id, (tab) => {
        const listPrice =
          tab.mode === "retail" ? product.retailPrice : product.wholesalePrice;
        const existing = tab.lines.find((l) => l.productId === product.id);
        if (existing) {
          return {
            ...tab,
            lines: tab.lines.map((l) =>
              l.productId === product.id ? { ...l, qty: l.qty + 1 } : l,
            ),
          };
        }
        const line: CartLine = {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          qty: 1,
          unitPrice: listPrice,
          listPrice,
          stockQty: product.stockQty,
          allowBargain: product.allowBargain,
        };
        return { ...tab, lines: [...tab.lines, line] };
      });
    },
    [active.id, updateTab],
  );

  /** Switch mode and re-price every line to the catalogue list price of that mode. */
  const switchMode = useCallback(
    (mode: "retail" | "wholesale", catalog: CatalogProduct[]) => {
      updateTab(active.id, (tab) => ({
        ...tab,
        mode,
        lines: tab.lines.map((l) => {
          const p = catalog.find((c) => c.id === l.productId);
          if (!p) return l;
          const listPrice = mode === "retail" ? p.retailPrice : p.wholesalePrice;
          return { ...l, listPrice, unitPrice: listPrice };
        }),
      }));
    },
    [active.id, updateTab],
  );

  const updateLine = useCallback(
    (productId: number, patch: Partial<CartLine>) => {
      updateTab(active.id, (tab) => ({
        ...tab,
        lines: tab.lines.map((l) =>
          l.productId === productId ? { ...l, ...patch } : l,
        ),
      }));
    },
    [active.id, updateTab],
  );

  const removeLine = useCallback(
    (productId: number) => {
      updateTab(active.id, (tab) => ({
        ...tab,
        lines: tab.lines.filter((l) => l.productId !== productId),
      }));
    },
    [active.id, updateTab],
  );

  const clearActive = useCallback(() => {
    updateTab(active.id, (t) => ({ ...newTab(1), id: t.id, label: t.label }));
  }, [active.id, updateTab]);

  return {
    tabs,
    active,
    activeId,
    setActiveId,
    addTab,
    closeTab,
    addProduct,
    switchMode,
    updateLine,
    removeLine,
    clearActive,
    updateTab,
  };
}
