import Link from "next/link";
import { Check, Sparkles } from "lucide-react";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "./section-heading";
import { tiers } from "@/lib/site-data";
import { cn } from "@/lib/utils";

export function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6 lg:py-28">
      <SectionHeading
        eyebrow="Pricing"
        title={<>One plan for the <span className="text-gradient">whole household.</span></>}
        subtitle="Every plan spans every service. Change or cancel whenever you like — there's no lock-in."
      />

      <ScrollReveal className="mt-14 grid items-stretch gap-6 lg:grid-cols-3" stagger={120}>
        {tiers.map((t) => (
          <div
            key={t.name}
            className={cn(
              "relative flex h-full flex-col rounded-3xl p-7",
              t.featured
                ? "glass-strong ring-2 ring-primary/50 shadow-glow lg:-my-3 lg:py-10"
                : "glass",
            )}
          >
            {t.featured && (
              <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-glow">
                <Sparkles className="size-3.5" /> Most popular
              </span>
            )}
            <h3 className="font-display text-xl font-semibold">{t.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.blurb}</p>
            <p className="mt-5 flex items-baseline gap-1">
              <span className="font-display text-4xl font-bold tracking-tight">₹{t.price.toLocaleString("en-IN")}</span>
              <span className="text-sm text-muted-foreground">{t.cadence}</span>
            </p>

            <Button asChild className="mt-6 w-full" variant={t.featured ? "primary" : "glass"}>
              <Link href="/app">Choose {t.name}</Link>
            </Button>

            <ul className="mt-6 flex flex-1 flex-col gap-3">
              {t.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm">
                  <Check className={cn("mt-0.5 size-4 shrink-0", t.featured ? "text-primary" : "text-accent")} />
                  <span className="text-foreground/90">{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </ScrollReveal>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Prices are per household and exclude GST where applicable.
      </p>
    </section>
  );
}
