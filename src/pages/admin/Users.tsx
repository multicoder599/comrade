import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/providers/trpc";
import { errorMessage } from "@/lib/auth";
import { UserPlus } from "lucide-react";

export default function Users() {
  const listQuery = trpc.auth.listUsers.useQuery();
  const create = trpc.auth.createUser.useMutation({
    onSuccess: () => {
      listQuery.refetch();
      setForm({ username: "", password: "", displayName: "", role: "cashier", shop: "A" });
      setFeedback("User created");
    },
    onError: (e) => setFeedback(errorMessage(e)),
  });
  const update = trpc.auth.updateUser.useMutation({
    onSuccess: () => listQuery.refetch(),
    onError: (e) => setFeedback(errorMessage(e)),
  });

  const [form, setForm] = useState({
    username: "",
    password: "",
    displayName: "",
    role: "cashier" as "cashier" | "admin",
    shop: "A" as "A" | "B",
  });
  const [feedback, setFeedback] = useState<string | null>(null);
  const [resetId, setResetId] = useState<number | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  return (
    <div className="space-y-5">
      <div>
        <p className="micro-label">Accounts</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
      </div>

      {/* Create user */}
      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="font-display font-semibold flex items-center gap-2">
          <UserPlus className="size-4 text-primary" />
          Add a cashier or admin
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
          <Input
            placeholder="Display name"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="bg-background border-input"
          />
          <Input
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="bg-background border-input"
          />
          <Input
            placeholder="Password (min 6)"
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="bg-background border-input"
          />
          <div className="flex gap-2">
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as "cashier" | "admin" })}
            >
              <SelectTrigger className="bg-background border-input">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover border-border">
                <SelectItem value="cashier">Cashier</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            {form.role === "cashier" && (
              <Select
                value={form.shop}
                onValueChange={(v) => setForm({ ...form, shop: v as "A" | "B" })}
              >
                <SelectTrigger className="bg-background border-input">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover border-border">
                  <SelectItem value="A">Shop A</SelectItem>
                  <SelectItem value="B">Shop B</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={
              create.isPending ||
              !form.username.trim() ||
              !form.displayName.trim() ||
              form.password.length < 6
            }
            onClick={() =>
              create.mutate({
                username: form.username,
                password: form.password,
                displayName: form.displayName,
                role: form.role,
                shop: form.role === "cashier" ? form.shop : undefined,
              })
            }
          >
            {create.isPending ? "Creating…" : "Create user"}
          </Button>
        </div>
        {feedback && <p className="text-sm text-muted-foreground">{feedback}</p>}
      </section>

      {/* User list */}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Shop</TableHead>
              <TableHead className="text-center">Active</TableHead>
              <TableHead>Reset password</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(listQuery.data ?? []).map((u) => (
              <TableRow key={u.id} className="border-border">
                <TableCell className="font-medium">{u.displayName}</TableCell>
                <TableCell className="text-muted-foreground">{u.username}</TableCell>
                <TableCell className="capitalize">{u.role}</TableCell>
                <TableCell>{u.shop ?? "—"}</TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={u.active}
                    onCheckedChange={(active) =>
                      update.mutate({ id: u.id, active })
                    }
                    aria-label={`Toggle ${u.username}`}
                  />
                </TableCell>
                <TableCell>
                  {resetId === u.id ? (
                    <div className="flex gap-1.5">
                      <Input
                        placeholder="New password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        className="h-8 bg-background border-input w-36"
                      />
                      <Button
                        size="sm"
                        className="h-8 bg-primary text-primary-foreground"
                        disabled={resetPassword.length < 6 || update.isPending}
                        onClick={() => {
                          update.mutate({ id: u.id, password: resetPassword });
                          setResetId(null);
                          setResetPassword("");
                        }}
                      >
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => setResetId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 border-border"
                      onClick={() => setResetId(u.id)}
                    >
                      Reset
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
