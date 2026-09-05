"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, Star, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceHero } from "@/components/site/service-hero";
import { CountUp } from "@/components/ui/count-up";
import { stats } from "@/lib/site-data";

// The hero pairs a plain, confident message with a live visual built from the real
// services, so the page says what Wash N Press does the moment it loads.
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-8 pt-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pt-16">
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground glass">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-accent" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            Now serving 180+ gated communities
          </span>

          <h1 className="mt-5 text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Laundry, ironing, dry clean &amp; car care,{" "}
            <span className="text-gradient">at your door.</span>
          </h1>

          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Book any service, watch every step happen live, and let one subscription cover
            the whole household. Built for the way gated communities actually live.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/app">
                Open the app <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="glass">
              <a href="#pricing">See plans &amp; pricing</a>
            </Button>
          </div>

          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-muted-foreground">
            <li className="inline-flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" /> No lock-in
            </li>
            <li className="inline-flex items-center gap-2">
              <Truck className="size-4 text-primary" /> Same-day pickup
            </li>
            <li className="inline-flex items-center gap-2">
              <Star className="size-4 text-accent" /> 4.9/5 from 12,000+ homes
            </li>
          </ul>
        </div>

        <ServiceHero />
      </div>

      <div className="mx-auto max-w-7xl px-4 pb-6 sm:px-6">
        <dl className="grid grid-cols-2 gap-3 rounded-3xl p-4 glass sm:grid-cols-4 sm:gap-2 sm:p-6">
          {stats.map((s) => (
            <div key={s.label} className="px-3 py-2 text-center sm:text-left">
              <dt className="sr-only">{s.label}</dt>
              <dd className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                <CountUp to={s.value} suffix={s.suffix} prefix={s.prefix} decimals={s.decimals} />
              </dd>
              <p aria-hidden="true" className="mt-1 text-xs text-muted-foreground sm:text-sm">
                {s.label}
              </p>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
