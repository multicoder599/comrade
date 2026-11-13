import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/providers/trpc";

export type SessionUser = {
  id: number;
  username: string;
  displayName: string;
  role: "admin" | "cashier";
  shop: "A" | "B" | null;
  active: boolean;
};

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  login: (username: string, password: string, shop?: "A" | "B") => Promise<SessionUser>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = "comrade_token";
const USER_KEY = "comrade_user";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as SessionUser) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  const loginMutation = trpc.auth.login.useMutation();
  const meQuery = trpc.auth.me.useQuery(undefined, {
    enabled: Boolean(localStorage.getItem(TOKEN_KEY)),
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    if (meQuery.data) {
      setUser(meQuery.data as SessionUser);
      localStorage.setItem(USER_KEY, JSON.stringify(meQuery.data));
      setLoading(false);
    } else if (meQuery.isError) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
      setLoading(false);
    }
  }, [meQuery.data, meQuery.isError]);

  const login = useCallback(
    async (username: string, password: string, shop?: "A" | "B") => {
      const result = await loginMutation.mutateAsync({ username, password, shop });
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      setUser(result.user as SessionUser);
      return result.user as SessionUser;
    },
    [loginMutation],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setUser(null);
    window.location.href = "/";
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message);
    // tRPC wraps server errors as JSON-ish strings on some paths
    try {
      const parsed = JSON.parse(msg) as { message?: string }[];
      if (Array.isArray(parsed) && parsed[0]?.message) return parsed[0].message;
    } catch {
      /* plain message */
    }
    return msg;
  }
  return "Something went wrong";
}
