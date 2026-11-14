import { useEffect } from "react";
import { trpc } from "@/providers/trpc";

/**
 * The till and the admin panel are the same SPA served on two ports.
 * This hook keeps them apart: the shop port never shows admin pages and
 * the admin port never shows the till. Any other port (local dev on 3000,
 * the preview) can reach both.
 */
export function usePortGuard(side: "shop" | "admin") {
  const portsQuery = trpc.settings.ports.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    const ports = portsQuery.data;
    if (!ports) return;
    const current =
      window.location.port ||
      (window.location.protocol === "https:" ? "443" : "80");
    const shop = String(ports.shopPort);
    const admin = String(ports.adminPort);
    if (shop === admin) return;
    if (side === "shop" && current === admin) {
      window.location.replace("/admin");
    } else if (side === "admin" && current === shop) {
      window.location.replace("/");
    }
  }, [portsQuery.data, side]);

  return portsQuery.data ?? null;
}

/** Absolute URL of the other side (used for the cross-links on login pages). */
export function sideUrl(side: "shop" | "admin", ports: { shopPort: number; adminPort: number } | null): string {
  if (!ports) return side === "shop" ? "/" : "/admin";
  const port = side === "shop" ? ports.shopPort : ports.adminPort;
  const path = side === "shop" ? "/" : "/admin";
  return `${window.location.protocol}//${window.location.hostname}:${port}${path}`;
}
