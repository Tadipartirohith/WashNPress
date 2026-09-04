import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import "./globals.css";

// Two families, no more. Space Grotesk sets the display voice — headings and the
// wordmark — while Inter carries the body. Both are exposed as CSS variables so
// Tailwind's `font-display` / `font-sans` classes resolve to them.
const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://washnpress.example"),
  title: {
    default: "WashNPress — Laundry, car care & ironing for gated communities",
    template: "%s · WashNPress",
  },
  description:
    "Doorstep laundry, car washing and ironing for gated communities. Book a slot, track every step live, and let your subscription do the rest.",
  keywords: ["laundry", "car wash", "ironing", "gated community", "subscription", "doorstep pickup"],
  openGraph: {
    title: "WashNPress — Laundry, car care & ironing, at your door",
    description:
      "Book a slot, track every step live, and let your subscription do the rest. Built for gated communities.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0f1e" },
    { media: "(prefers-color-scheme: light)", color: "#f5f8ff" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${display.variable} ${sans.variable}`}>
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
