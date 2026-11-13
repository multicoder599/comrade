import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, errorMessage } from "@/lib/auth";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function AdminLogin() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(username, password);
      if (user.role !== "admin") {
        setError("This account is not an admin. Use the shop login for tills.");
        return;
      }
      navigate("/admin/dashboard");
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
        <Link to="/" className="micro-label hover:text-foreground transition-colors">
          Shop login
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1.5 text-center">
            <ShieldCheck className="size-8 mx-auto text-primary" strokeWidth={1.5} />
            <p className="micro-label">Back office · port 5106</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight">
              Admin panel
            </h1>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="admin-username">Username</Label>
              <Input
                id="admin-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="bg-card border-input h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Password</Label>
              <Input
                id="admin-password"
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
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
