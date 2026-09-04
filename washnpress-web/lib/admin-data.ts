import {
  IndianRupee, Package, Bike, Star, TrendingUp, TrendingDown,
  LayoutDashboard, ClipboardList, Users, Route, Wallet, Settings,
  type LucideIcon,
} from "lucide-react";

// Mock data for the admin/vendor dashboard. Purely visual.

export interface Kpi {
  label: string;
  value: string;
  delta: number; // percentage, signed
  icon: LucideIcon;
  tint: "primary" | "accent" | "success";
}

export const kpis: Kpi[] = [
  { label: "Revenue today", value: "₹1,48,200", delta: 12.4, icon: IndianRupee, tint: "primary" },
  { label: "Active orders", value: "312", delta: 8.1, icon: Package, tint: "accent" },
  { label: "Riders on shift", value: "24", delta: -4.0, icon: Bike, tint: "success" },
  { label: "Satisfaction", value: "4.9/5", delta: 1.2, icon: Star, tint: "accent" },
];

export interface DayRevenue {
  day: string;
  value: number; // in thousands of rupees
}

// Seven days; the chart resolves bar heights against the largest value.
export const weeklyRevenue: DayRevenue[] = [
  { day: "Mon", value: 92 },
  { day: "Tue", value: 118 },
  { day: "Wed", value: 104 },
  { day: "Thu", value: 141 },
  { day: "Fri", value: 176 },
  { day: "Sat", value: 198 },
  { day: "Sun", value: 148 },
];

export interface Rider {
  name: string;
  zone: string;
  status: "on_route" | "available" | "break" | "off";
  orders: number;
}

export const riders: Rider[] = [
  { name: "Kiran R.", zone: "Whitefield", status: "on_route", orders: 6 },
  { name: "Deepak M.", zone: "Sarjapur", status: "on_route", orders: 5 },
  { name: "Fahad A.", zone: "Indiranagar", status: "available", orders: 3 },
  { name: "Sunita P.", zone: "HSR Layout", status: "break", orders: 4 },
  { name: "Manoj K.", zone: "Koramangala", status: "available", orders: 2 },
];

export const riderStatusMeta: Record<Rider["status"], { label: string; tint: string }> = {
  on_route: { label: "On route", tint: "primary" },
  available: { label: "Available", tint: "success" },
  break: { label: "On break", tint: "accent" },
  off: { label: "Off shift", tint: "muted" },
};

export interface OrderRow {
  code: string;
  customer: string;
  service: string;
  amount: string;
  status: "delivered" | "washing" | "out" | "pending";
}

export const orderRows: OrderRow[] = [
  { code: "WNP-4821", customer: "Ananya Iyer", service: "Laundry", amount: "₹496", status: "out" },
  { code: "WNP-4820", customer: "Rahul Desai", service: "Car care", amount: "₹399", status: "washing" },
  { code: "WNP-4819", customer: "Sneha Rao", service: "Ironing", amount: "₹270", status: "delivered" },
  { code: "WNP-4818", customer: "Vikram Shetty", service: "Laundry", amount: "₹612", status: "washing" },
  { code: "WNP-4817", customer: "Priya Nair", service: "Premium", amount: "₹1,240", status: "pending" },
  { code: "WNP-4816", customer: "Arjun Mehta", service: "Car care", amount: "₹399", status: "delivered" },
];

export const orderStatusMeta: Record<OrderRow["status"], { label: string; tint: string }> = {
  delivered: { label: "Delivered", tint: "success" },
  washing: { label: "Washing", tint: "primary" },
  out: { label: "Out for delivery", tint: "accent" },
  pending: { label: "Pending", tint: "muted" },
};

export interface NavItem {
  icon: LucideIcon;
  label: string;
  active?: boolean;
}

export const adminNav: NavItem[] = [
  { icon: LayoutDashboard, label: "Overview", active: true },
  { icon: ClipboardList, label: "Orders" },
  { icon: Route, label: "Riders" },
  { icon: Users, label: "Customers" },
  { icon: Wallet, label: "Revenue" },
  { icon: Settings, label: "Settings" },
];

export const trend = { up: TrendingUp, down: TrendingDown };
