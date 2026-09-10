import { images, type Img } from "./images";
import {
  Shirt, Car, Wind, Repeat, CalendarClock, Truck, Sparkles, PackageCheck,
  type LucideIcon,
} from "lucide-react";

export interface Service {
  icon: LucideIcon;
  title: string;
  description: string;
  points: string[];
  image: Img;
  tag: string;
}

export const services: Service[] = [
  {
    icon: Shirt,
    title: "Laundry & wash-fold",
    description: "Everyday washing, dried and folded, weighed by the kilo and back before you notice it left.",
    points: ["Wash, dry & fold", "Priced by weight", "48-hour turnaround"],
    image: images.laundry,
    tag: "Priced by weight",
  },
  {
    icon: Car,
    title: "Car care at your bay",
    description: "A foam wash and detail in your own parking bay, booked to a slot that fits your morning.",
    points: ["Exterior foam wash", "Interior detailing", "At your parking bay"],
    image: images.carCare,
    tag: "Booked to a slot",
  },
  {
    icon: Wind,
    title: "Steam ironing & press",
    description: "Crisp, steam-pressed garments on hangers, counted by the piece and hung ready to wear.",
    points: ["Per-garment pricing", "Steam-pressed", "On hangers"],
    image: images.ironing,
    tag: "",
  },
  {
    icon: Repeat,
    title: "Subscriptions",
    description: "One monthly plan for washing, ironing and — on Premium Care — dry cleaning, with a garment allowance that carries your household.",
    points: ["Wash, iron & dry clean", "Monthly garment allowance", "Cancel anytime"],
    image: images.subscription,
    tag: "Best value",
  },
];

export interface Step {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const steps: Step[] = [
  { icon: CalendarClock, title: "Book a slot", description: "Pick a service and a pickup window that fits your day, from your phone." },
  { icon: Truck, title: "We collect", description: "A rider arrives at your door within the window and scans your order in." },
  { icon: Sparkles, title: "We clean", description: "Washed, pressed or detailed to standard, with every step recorded against your order." },
  { icon: PackageCheck, title: "Delivered back", description: "Back at your door, fresh and folded, with a receipt in the app." },
];

export interface Tier {
  name: string;
  price: number;
  cadence: string;
  blurb: string;
  features: string[];
  featured: boolean;
  // Why this tier is highlighted, said as a fact about the plan rather than a claim
  // about how many people buy it. Only the featured tier carries one.
  badge?: string;
}

// The four plans the backend actually sells, transcribed from the plan catalogue:
// name, monthly price, garment cap, turnaround and pickups per cycle all come from
// the seeded plans, so the marketing page and the Plan screen quote the same numbers.
//
// This list used to read Starter ₹499 / Family ₹1,299 / Estate ₹2,499. "Estate" has
// never existed, "Family" is ₹1,999 and not ₹1,299, and the ₹2,499 tier advertised
// unlimited garments against a catalogue where every plan is capped. A price on a
// storefront that no plan can be bought at is a false representation, and Apple 2.3.1
// treats it as grounds for removing the account, not just the build.
export const tiers: Tier[] = [
  {
    name: "Basic",
    price: 499,
    cadence: "/month",
    blurb: "Weekly washing for a small household.",
    features: ["40 garments a month", "Wash & iron, and iron-only", "48-hour turnaround", "4 pickups a cycle", "In-app tracking"],
    featured: false,
  },
  {
    name: "Standard",
    price: 899,
    cadence: "/month",
    blurb: "More washing, and ironing twice a week.",
    features: ["80 garments a month", "Wash & iron, wash-only, iron-only", "36-hour turnaround", "8 pickups a cycle", "In-app tracking"],
    featured: false,
  },
  {
    name: "Premium Care",
    price: 1299,
    cadence: "/month",
    blurb: "Everything, including dry cleaning.",
    features: ["120 garments a month", "Dry cleaning included", "24-hour turnaround", "15 pickups a cycle", "Unused dry cleaning carries over"],
    featured: true,
    badge: "Fastest turnaround",
  },
  {
    name: "Family Pack",
    price: 1999,
    cadence: "/month",
    blurb: "Built for a full household.",
    features: ["200 garments a month", "Wash & iron, wash-only, iron-only", "36-hour turnaround", "15 pickups a cycle", "Ironing collected Tuesdays & Fridays"],
    featured: false,
  },
];

// Six named residents with quoted five-star reviews used to live here, alongside an
// "Orders delivered 240K+ / Communities served 180+ / On-time rate 99.2% / Average
// rating 4.9" band. None of it was measured — one of the reviews praised live
// tracking, which the product does not have — and invented endorsements and invented
// performance figures are exactly what Apple 2.3.1 and the ASCI code on misleading
// advertising exist to catch. The reviews section is gone rather than relabelled: a
// card with a face, a name and five stars reads as a real customer however it is
// captioned.
//
// What is left are facts taken straight from the plan catalogue, so every number on
// the page can be traced to something the product actually sells.
export interface Stat {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}

export const stats: Stat[] = [
  { label: "Services on one plan", value: 4 },
  { label: "Standard turnaround", value: 48, suffix: " hrs" },
  { label: "Premium Care turnaround", value: 24, suffix: " hrs" },
  { label: "Plans start at", value: 499, prefix: "₹" },
];
