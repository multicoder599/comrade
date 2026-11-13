import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, errorMessage } from "@/lib/auth";
import { trpc } from "@/providers/trpc";
import { Store, Loader2 } from "lucide-react";

export default function ShopLogin() {
  const [shop, setShop] = useState<"A" | "B" | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    retry: false,
    enabled: false,
  });
  void settingsQuery;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shop) {
      setError("Choose Shop A or Shop B first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username, password, shop);
      navigate("/pos");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
          <span className="font-display font-semibold tracking-tight text-lg">
            Comrade Shop
          </span>
        </div>
        <Link
          to="/admin"
          className="micro-label hover:text-foreground transition-colors"
        >
          Admin login
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-8">
          <div className="space-y-1.5 text-center">
            <p className="micro-label">Cashier terminal</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Open the till
            </h1>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(["A", "B"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setShop(s)}
                className={`group flex flex-col items-center gap-2 rounded-lg border p-5 transition-colors cursor-pointer ${
                  shop === s
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground"
                }`}
              >
                <Store className="size-6" strokeWidth={1.75} />
                <span className="font-display text-xl font-semibold">
                  Shop {s}
                </span>
                <span
                  className={`micro-label ${shop === s ? "text-primary" : ""}`}
                >
                  {shop === s ? "Selected" : "Tap to select"}
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. shopa"
                className="bg-card border-input h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-card border-input h-11"
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy}
              className="w-full h-11 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                `Start selling${shop ? ` — Shop ${shop}` : ""}`
              )}
            </Button>
          </form>
        </div>
      </main>

      <footer className="px-6 py-3 border-t border-border flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-[#b0ffc4]" />
        <span className="text-xs text-muted-foreground">
          System online · Shop till port 5105
        </span>
      </footer>
    </div>
  );
}
