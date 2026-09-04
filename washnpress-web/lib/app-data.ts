import {
  Shirt, Car, Wind, Sparkles, MapPin, Bell, CreditCard, ShieldCheck,
  Truck, PackageCheck, WashingMachine, ClipboardCheck, type LucideIcon,
} from "lucide-react";

// Mock data for the customer app surface. Purely visual — no network, no storage.

export const customer = {
  name: "Ananya",
  fullName: "Ananya Iyer",
  unit: "Purva Highland, Tower 3 · 12B",
  phone: "+91 98765 43210",
  plan: "Family",
  planAllowanceUsed: 68,
  planAllowanceTotal: 120,
  walletPaise: 142000,
};

export interface QuickAction {
  icon: LucideIcon;
  label: string;
  tint: string;
}

export const quickActions: QuickAction[] = [
  { icon: Shirt, label: "Laundry", tint: "primary" },
  { icon: Car, label: "Car wash", tint: "accent" },
  { icon: Wind, label: "Ironing", tint: "primary" },
  { icon: Sparkles, label: "Premium", tint: "accent" },
];

export interface TrackStep {
  key: string;
  label: string;
  icon: LucideIcon;
  at: string | null;
}

export interface AppOrder {
  id: string;
  code: string;
  service: string;
  items: string;
  placedAt: string;
  etaLabel: string;
  amountPaise: number;
  currentStep: number; // index into steps
  steps: TrackStep[];
}

function steps(done: number): TrackStep[] {
  const base = [
    { key: "booked", label: "Order placed", icon: ClipboardCheck },
    { key: "picked", label: "Picked up", icon: Truck },
    { key: "washing", label: "Washing & press", icon: WashingMachine },
    { key: "delivery", label: "Out for delivery", icon: PackageCheck },
    { key: "delivered", label: "Delivered", icon: ShieldCheck },
  ];
  const times = ["Today, 7:10 AM", "Today, 8:45 AM", "Today, 10:20 AM", "Today, 1:05 PM", "Today, 4:30 PM"];
  return base.map((s, i) => ({ ...s, at: i <= done ? times[i] : null }));
}

export const activeOrder: AppOrder = {
  id: "o1",
  code: "WNP-4821",
  service: "Laundry & wash-fold",
  items: "6.2 kg · wash, dry & fold",
  placedAt: "Today, 7:10 AM",
  etaLabel: "Arriving in ~6 min",
  amountPaise: 49600,
  currentStep: 3,
  steps: steps(3),
};

export const orders: AppOrder[] = [
  activeOrder,
  {
    id: "o2",
    code: "WNP-4790",
    service: "Car care at your bay",
    items: "Sedan · foam wash + interior",
    placedAt: "Yesterday, 9:00 AM",
    etaLabel: "Delivered",
    amountPaise: 39900,
    currentStep: 4,
    steps: steps(4),
  },
  {
    id: "o3",
    code: "WNP-4754",
    service: "Steam ironing & press",
    items: "18 garments",
    placedAt: "Mon, 8:20 AM",
    etaLabel: "Delivered",
    amountPaise: 27000,
    currentStep: 4,
    steps: steps(4),
  },
];

export interface BookableService {
  id: string;
  icon: LucideIcon;
  name: string;
  unit: string;
  ratePaise: number;
}

export const bookableServices: BookableService[] = [
  { id: "laundry", icon: Shirt, name: "Laundry & wash-fold", unit: "kg", ratePaise: 8000 },
  { id: "car", icon: Car, name: "Car care", unit: "wash", ratePaise: 39900 },
  { id: "iron", icon: Wind, name: "Steam ironing", unit: "garment", ratePaise: 1500 },
  { id: "premium", icon: Sparkles, name: "Premium care", unit: "garment", ratePaise: 12000 },
];

export const timeSlots = [
  { id: "s1", label: "8:00 – 10:00 AM", note: "2 slots left" },
  { id: "s2", label: "10:00 – 12:00 PM", note: "Popular" },
  { id: "s3", label: "12:00 – 2:00 PM", note: "" },
  { id: "s4", label: "4:00 – 6:00 PM", note: "1 slot left" },
];

export interface Address {
  id: string;
  label: string;
  line: string;
  icon: LucideIcon;
  primary: boolean;
}

export const addresses: Address[] = [
  { id: "a1", label: "Home", line: "Purva Highland, Tower 3 · 12B", icon: MapPin, primary: true },
  { id: "a2", label: "Parents", line: "Sobha City, Block C · 4A", icon: MapPin, primary: false },
];

export const settings = [
  { icon: Bell, label: "Notifications", value: "On" },
  { icon: CreditCard, label: "Payment methods", value: "UPI · Card" },
  { icon: ShieldCheck, label: "Privacy & security", value: "" },
];
