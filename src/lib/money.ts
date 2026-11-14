// Money helpers — all amounts are integer cents (KES).

export function formatKes(cents: number, opts?: { decimals?: boolean }): string {
  const value = cents / 100;
  const showDecimals = opts?.decimals ?? cents % 100 !== 0;
  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPlain(cents: number): string {
  const value = cents / 100;
  return value.toLocaleString("en-KE", {
    minimumFractionDigits: value % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Parse a user-typed KES amount ("1,250.50" | "65") into cents. */
export function parseKes(input: string): number | null {
  const cleaned = input.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function formatQty(qty: number): string {
  return qty % 1 === 0 ? String(qty) : qty.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Receipt style: always two decimals, no currency prefix ("1,250.00"). */
export function formatAmount2(cents: number): string {
  return (cents / 100).toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
