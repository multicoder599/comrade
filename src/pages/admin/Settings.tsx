import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { errorMessage, useAuth } from "@/lib/auth";

export default function Settings() {
  const settingsQuery = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSuccess: () => {
      settingsQuery.refetch();
      setFeedback("Settings saved");
    },
    onError: (e) => setFeedback(errorMessage(e)),
  });
  const changePassword = trpc.auth.changePassword.useMutation({
    onSuccess: () => setPwFeedback("Password changed"),
    onError: (e) => setPwFeedback(errorMessage(e)),
  });
  const { user } = useAuth();

  const [businessName, setBusinessName] = useState("");
  const [shopAName, setShopAName] = useState("");
  const [shopBName, setShopBName] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwFeedback, setPwFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (settingsQuery.data) {
      setBusinessName(settingsQuery.data.businessName);
      setShopAName(settingsQuery.data.shopAName);
      setShopBName(settingsQuery.data.shopBName);
    }
  }, [settingsQuery.data]);

  const megapay = settingsQuery.data?.megapayConfigured;
  const megapayA = megapay?.A ?? false;
  const megapayB = megapay?.B ?? false;

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <p className="micro-label">Configuration</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        {settingsQuery.data?.appVersion && (
          <p className="text-xs text-muted-foreground mt-1">
            App version {settingsQuery.data.appVersion}
          </p>
        )}
      </div>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-display font-semibold">Shop names</h2>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>Business name (receipts)</Label>
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="bg-background border-input"
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Shop A name</Label>
              <Input
                value={shopAName}
                onChange={(e) => setShopAName(e.target.value)}
                className="bg-background border-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Shop B name</Label>
              <Input
                value={shopBName}
                onChange={(e) => setShopBName(e.target.value)}
                className="bg-background border-input"
              />
            </div>
          </div>
        </div>
        <Button
          className="bg-primary text-primary-foreground hover:bg-primary/90"
          disabled={update.isPending}
          onClick={() =>
            update.mutate({ businessName, shopAName, shopBName })
          }
        >
          {update.isPending ? "Saving…" : "Save settings"}
        </Button>
        {feedback && <p className="text-sm text-muted-foreground">{feedback}</p>}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-display font-semibold">MegaPay (M-Pesa)</h2>
        <p className="text-xs text-muted-foreground">
          Each shop prompts through its own MegaPay account, so the money
          lands in the right account.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`size-2 rounded-full ${
              megapayA ? "bg-success" : "bg-destructive"
            }`}
          />
          {megapayA ? (
            <span>Shop A — configured, can send M-Pesa prompts.</span>
          ) : (
            <span>
              Shop A — not configured. Set{" "}
              <code className="font-figures text-xs">MEGAPAY_API_KEY</code> and{" "}
              <code className="font-figures text-xs">MEGAPAY_EMAIL</code> in the
              server <code className="font-figures text-xs">.env</code>, then restart.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span
            className={`size-2 rounded-full ${
              megapayB ? "bg-success" : "bg-destructive"
            }`}
          />
          {megapayB ? (
            <span>Shop B — configured, can send M-Pesa prompts.</span>
          ) : (
            <span>
              Shop B — not configured. Set{" "}
              <code className="font-figures text-xs">MEGAPAY_B_API_KEY</code> and{" "}
              <code className="font-figures text-xs">MEGAPAY_B_EMAIL</code> in the
              server <code className="font-figures text-xs">.env</code>, then restart.
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Webhook URL — set this in BOTH MegaPay accounts' dashboards:{" "}
          <code className="font-figures">
            http://169.58.58.133:5105/api/megapay/webhook
          </code>
        </p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-display font-semibold">
          Change my password {user ? `(${user.username})` : ""}
        </h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input
              type="password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className="bg-background border-input"
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>New password (min 6)</Label>
            <Input
              type="password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className="bg-background border-input"
              autoComplete="new-password"
            />
          </div>
        </div>
        <Button
          variant="outline"
          className="border-border"
          disabled={changePassword.isPending || newPw.length < 6 || !currentPw}
          onClick={() =>
            changePassword.mutate({ currentPassword: currentPw, newPassword: newPw })
          }
        >
          Change password
        </Button>
        {pwFeedback && (
          <p className="text-sm text-muted-foreground">{pwFeedback}</p>
        )}
      </section>
    </div>
  );
}
