import { useEffect, useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { RefreshCw } from "lucide-react";

/**
 * Watches the server's boot id (changes on every deploy / pm2 restart).
 * When it differs from the one this page loaded with, the browser is
 * running stale code — offer a one-tap refresh that also forces the
 * service worker to grab the latest bundle.
 */
export function UpdateBanner() {
  const query = trpc.settings.get.useQuery(undefined, {
    retry: false,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });
  const [stale, setStale] = useState(false);
  const bootId = useRef<string | null>(null);

  useEffect(() => {
    const current = query.data?.bootId;
    if (!current) return;
    if (bootId.current === null) {
      bootId.current = current;
    } else if (bootId.current !== current) {
      setStale(true);
    }
  }, [query.data?.bootId]);

  if (!stale) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          const regs = await navigator.serviceWorker?.getRegistrations();
          await Promise.all(regs?.map((r) => r.update()) ?? []);
        } finally {
          window.location.reload();
        }
      }}
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg cursor-pointer animate-in fade-in"
    >
      <RefreshCw className="size-4" />
      New version installed — tap to refresh
    </button>
  );
}
