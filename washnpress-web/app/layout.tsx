import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// One family. Plus Jakarta Sans carries headings, the wordmark and the body. It is
// exposed as --font-sans, and globals.css points --font-display at the same face, so
// Tailwind's `font-display` / `font-sans` classes both resolve to it.
const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
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
    "Doorstep laundry, car washing and ironing for gated communities. Book a slot, follow your order from pickup to delivery, and let your subscription do the rest.",
  keywords: ["laundry", "car wash", "ironing", "gated community", "subscription", "doorstep pickup"],
  // Stated rather than left to inference: the manifest is what an installed app
  // takes its name and icon from, and the app title is what iOS puts under the
  // home-screen icon.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Wash N Press", statusBarStyle: "default" },
  openGraph: {
    title: "WashNPress — Laundry, car care & ironing, at your door",
    description:
      "Book a slot, follow your order from pickup to delivery, and let your subscription do the rest. Built for gated communities.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1424" },
    { media: "(prefers-color-scheme: light)", color: "#e8f1fc" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable} suppressHydrationWarning>
      <head>
        {/* I-78: light is the default. Apply the saved theme before first paint so
            there is no flash; only a previously chosen "dark" adds the class. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('wnp_theme')==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="bg-background font-sans text-foreground antialiased">{children}</body>
    </html>
  );
}
