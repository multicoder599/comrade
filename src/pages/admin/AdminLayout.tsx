import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { usePortGuard } from "@/lib/ports";
import { trpc } from "@/providers/trpc";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ReceiptText,
  BarChart3,
  Users,
  Settings,
  LogOut,
  Menu,
  Wallet,
} from "lucide-react";

const NAV = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/products", label: "Products & Prices", icon: Package },
  { to: "/admin/stock", label: "Stock", icon: Boxes },
  { to: "/admin/sales", label: "Sales", icon: ReceiptText },
  { to: "/admin/debts", label: "Debts", icon: Wallet },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/users", label: "Users", icon: Users },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminLayout() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  usePortGuard("admin");
  const settingsQuery = trpc.settings.get.useQuery(undefined, {
    enabled: user?.role === "admin",
    retry: false,
  });

  if (loading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }
  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground">Admin access required.</p>
          <Button
            onClick={() => navigate("/admin")}
            className="bg-primary text-primary-foreground"
          >
            Go to admin login
          </Button>
        </div>
      </div>
    );
  }

  const businessName = settingsQuery.data?.businessName ?? "Comrade Shop";

  const navItems = (onNavigate?: () => void) =>
    NAV.map((item) => (
      <NavLink
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
            isActive
              ? "bg-sidebar-accent text-foreground font-medium"
              : "text-sidebar-foreground hover:text-foreground hover:bg-sidebar-accent/60"
          }`
        }
      >
        <item.icon className="size-4" strokeWidth={1.75} />
        {item.label}
      </NavLink>
    ));

  return (
    <div className="min-h-dvh bg-background flex flex-col">
      {/* Mobile top bar */}
      <header className="md:hidden flex items-center gap-2.5 px-4 py-3 border-b border-border shrink-0">
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setNavOpen(true)}
          className="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <Menu className="size-4" />
        </button>
        <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
        <span className="font-display font-semibold tracking-tight">
          {businessName}
        </span>
        <span className="micro-label">Admin</span>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar (desktop) */}
        <aside className="hidden md:flex w-56 shrink-0 border-r border-border bg-[hsl(var(--sidebar-background))] flex-col">
          <div className="px-4 py-4 border-b border-sidebar-border flex items-center gap-2">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            <div>
              <p className="font-display font-semibold tracking-tight leading-none">
                {businessName}
              </p>
              <p className="micro-label mt-1">Admin</p>
            </div>
          </div>
          <nav className="flex-1 p-2 space-y-0.5">{navItems()}</nav>
          <div className="p-3 border-t border-sidebar-border">
            <p className="text-xs text-muted-foreground mb-2">
              {user.displayName}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="w-full border-sidebar-border text-muted-foreground hover:text-foreground gap-1.5"
            >
              <LogOut className="size-3.5" />
              Log out
            </Button>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <div className="w-full p-4 md:p-6">
            <Outlet context={{ settings: settingsQuery.data }} />
          </div>
        </main>
      </div>

      {/* Mobile nav drawer */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          className="bg-card border-border w-72 p-0 flex flex-col"
        >
          <SheetHeader className="px-4 py-4 border-b border-border text-left">
            <SheetTitle className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
              <span className="font-display font-semibold tracking-tight">
                {businessName}
              </span>
            </SheetTitle>
            <SheetDescription className="sr-only">
              Admin navigation
            </SheetDescription>
          </SheetHeader>
          <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
            {navItems(() => setNavOpen(false))}
          </nav>
          <div className="p-3 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">
              {user.displayName}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="w-full border-border text-muted-foreground hover:text-foreground gap-1.5"
            >
              <LogOut className="size-3.5" />
              Log out
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
