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
    tag: "Most loved",
  },
  {
    icon: Car,
    title: "Car care at your bay",
    description: "A foam wash and detail in your own parking bay, booked to a slot that fits your morning.",
    points: ["Exterior foam wash", "Interior detailing", "At your parking bay"],
    image: images.carCare,
    tag: "Weekends fill fast",
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
    description: "One monthly plan across every service, with an allowance that carries your household.",
    points: ["One plan, every service", "Monthly allowance", "Cancel anytime"],
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
  { icon: Sparkles, title: "We clean", description: "Washed, pressed or detailed to standard, with every step tracked live." },
  { icon: PackageCheck, title: "Delivered back", description: "Back at your door, fresh and folded, with a receipt in the app." },
];

export interface Tier {
  name: string;
  price: number;
  cadence: string;
  blurb: string;
  features: string[];
  featured: boolean;
}

export const tiers: Tier[] = [
  {
    name: "Starter",
    price: 499,
    cadence: "/month",
    blurb: "For a small household keeping on top of the everyday wash.",
    features: ["40 garments a month", "Wash, dry & fold", "48-hour turnaround", "1 pickup a week", "In-app tracking"],
    featured: false,
  },
  {
    name: "Family",
    price: 1299,
    cadence: "/month",
    blurb: "The whole household, laundry and ironing, one plan.",
    features: ["120 garments a month", "Laundry + steam ironing", "24-hour priority turnaround", "3 pickups a week", "1 car wash included", "Priority support"],
    featured: true,
  },
  {
    name: "Estate",
    price: 2499,
    cadence: "/month",
    blurb: "Every service, generous allowances, for a full home.",
    features: ["Unlimited garments", "Every service included", "Same-day where available", "Daily pickups", "4 car washes a month", "Dedicated manager"],
    featured: false,
  },
];

export interface Testimonial {
  name: string;
  unit: string;
  quote: string;
  rating: number;
}

export const testimonials: Testimonial[] = [
  { name: "Priya Nair", unit: "Prestige Lakeside", quote: "The live tracking is the thing — I can see my laundry go from picked up to out for delivery without messaging anyone.", rating: 5 },
  { name: "Arjun Mehta", unit: "Brigade Gateway", quote: "Car wash in my own bay while I work. It's on the same plan as the laundry, which I still can't quite believe.", rating: 5 },
  { name: "Sneha Rao", unit: "Sobha City", quote: "Switched the whole family to the Family plan. The allowance carries us and the ironing comes back genuinely crisp.", rating: 5 },
  { name: "Vikram Shetty", unit: "Godrej Woodsman", quote: "Booked a slot at 7am, collected by 9, back the next evening folded. The app never left me guessing.", rating: 5 },
  { name: "Ananya Iyer", unit: "Purva Highland", quote: "The subscription pays for itself by the second week. Support actually answers, too.", rating: 5 },
  { name: "Rahul Desai", unit: "Mantri Espana", quote: "Every step is timestamped. As someone who likes to know where things are, this won me over.", rating: 5 },
];

export interface Stat {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
}

export const stats: Stat[] = [
  { label: "Orders delivered", value: 240, suffix: "K+" },
  { label: "Communities served", value: 180, suffix: "+" },
  { label: "On-time rate", value: 99.2, suffix: "%", decimals: 1 },
  { label: "Average rating", value: 4.9, suffix: "/5", decimals: 1 },
];
