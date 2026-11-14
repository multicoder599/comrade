import { Routes, Route, Navigate } from "react-router";
import ShopLogin from "./pages/ShopLogin";
import Pos from "./pages/Pos";
import AdminLogin from "./pages/admin/AdminLogin";
import AdminLayout from "./pages/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Products from "./pages/admin/Products";
import Stock from "./pages/admin/Stock";
import Sales from "./pages/admin/Sales";
import Debts from "./pages/admin/Debts";
import Reports from "./pages/admin/Reports";
import Users from "./pages/admin/Users";
import Settings from "./pages/admin/Settings";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ShopLogin />} />
      <Route path="/pos" element={<Pos />} />
      <Route path="/admin" element={<AdminLogin />} />
      <Route element={<AdminLayout />}>
        <Route path="/admin/dashboard" element={<Dashboard />} />
        <Route path="/admin/products" element={<Products />} />
        <Route path="/admin/stock" element={<Stock />} />
        <Route path="/admin/sales" element={<Sales />} />
        <Route path="/admin/debts" element={<Debts />} />
        <Route path="/admin/reports" element={<Reports />} />
        <Route path="/admin/users" element={<Users />} />
        <Route path="/admin/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
