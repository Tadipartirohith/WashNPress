"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, Star, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { images } from "@/lib/images";
import { stats } from "@/lib/site-data";

// The signature moment: a live, layered hero. Real photography rides inside floating
// glass cards over an ambient field, a live-order chip pulses, and the stat bar counts
// up as it settles. Everything else on the page stays calm so this is the thing you
// remember.
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-8 pt-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pt-16">
        {/* Left — the message. */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground glass">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-pulse-ring rounded-full bg-accent" />
              <span className="relative inline-flex size-2 rounded-full bg-accent" />
            </span>
            Now serving 180+ gated communities
          </span>

          <h1 className="mt-5 text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
            Laundry, car care &amp; ironing,{" "}
            <span className="text-gradient">at your door.</span>
          </h1>

          <p className="mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Book a slot, watch every step happen live, and let one subscription cover the
            whole household. Built for the way gated communities actually live.
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

        {/* Right — the floating imagery. */}
        <div className="relative mx-auto h-[26rem] w-full max-w-md lg:h-[32rem]" aria-hidden="false">
          <FloatingCard
            className="left-0 top-6 w-52 animate-float lg:w-60"
            img={images.heroDrum}
            delay="0s"
          />
          <FloatingCard
            className="right-0 top-0 w-40 animate-float-slow lg:w-48"
            img={images.heroHome}
            delay="0.8s"
          />
          <FloatingCard
            className="bottom-14 right-6 w-52 animate-float lg:w-60"
            img={images.heroCar}
            delay="1.6s"
            style={{ animationDelay: "1.6s" }}
          />

          {/* A live-order chip, the app's personality leaking onto the page. */}
          <div className="absolute bottom-0 left-0 w-60 rounded-2xl p-3.5 glass-strong animate-float-slow">
            <div className="flex items-center gap-3">
              <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/30">
                <Truck className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Order WNP-4821</p>
                <p className="truncate text-sm font-medium">Out for delivery</p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10">
              <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-primary to-accent" />
            </div>
            <p className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="size-3" /> 6 minutes away
            </p>
          </div>
        </div>
      </div>

      {/* Stat bar. */}
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

function FloatingCard({
  className,
  img,
  delay,
  style,
}: {
  className: string;
  img: { src: string; alt: string };
  delay?: string;
  style?: React.CSSProperties;
}) {
  return (
    <figure
      className={`absolute overflow-hidden rounded-3xl p-1.5 glass-strong ${className}`}
      style={{ animationDelay: delay, ...style }}
    >
      <Image
        src={img.src}
        alt={img.alt}
        width={480}
        height={600}
        className="h-40 w-full rounded-2xl object-cover lg:h-52"
        priority
      />
    </figure>
  );
}
