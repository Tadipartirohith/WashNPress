import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Bell, MapPin, Sparkles } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { PhoneFrame } from "@/components/app/phone-frame";
import { CustomerApp } from "@/components/app/customer-app";

export const metadata: Metadata = {
  title: "Customer app",
  description: "Book a pickup, track every step live, and manage your subscription — the WashNPress customer app.",
};

const highlights = [
  { icon: MapPin, title: "Live tracking", body: "Watch your order move from picked up to delivered, timestamped at every step." },
  { icon: Sparkles, title: "One-tap booking", body: "Pick a service, a quantity and a slot in seconds — your address is already saved." },
  { icon: Bell, title: "Gentle nudges", body: "A ping when the rider is near, and when your order is back at the door." },
];

export default function AppPage() {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" className="rounded-xl focus-visible:ring-focus" aria-label="WashNPress home">
          <Logo />
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft className="size-4" /> Back to site
          </Link>
        </Button>
      </header>

      <main className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-4 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:pt-10">
        <div className="order-2 lg:order-1">
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-primary glass">
            Customer app
          </span>
          <h1 className="mt-4 text-balance font-display text-3xl font-bold leading-tight sm:text-4xl">
            Your whole household&rsquo;s laundry, <span className="text-gradient">in your pocket.</span>
          </h1>
          <p className="mt-4 max-w-md text-pretty leading-relaxed text-muted-foreground">
            This is the live app — tap through the tabs, book a pickup, and open an order to watch its
            timeline. It&rsquo;s a demonstration, so nothing is charged and no sign-in is needed.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {highlights.map((h) => (
              <li key={h.title} className="flex gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
                  <h.icon className="size-5" />
                </span>
                <div>
                  <p className="font-medium">{h.title}</p>
                  <p className="text-sm text-muted-foreground">{h.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="order-1 lg:order-2">
          <PhoneFrame>
            <CustomerApp />
          </PhoneFrame>
        </div>
      </main>
    </div>
  );
}
