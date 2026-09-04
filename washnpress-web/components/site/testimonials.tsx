import { Star } from "lucide-react";
import { SectionHeading } from "./section-heading";
import { testimonials, type Testimonial } from "@/lib/site-data";

// A marquee of real-sounding reviews. The track holds the list twice and slides by
// exactly half its width, so the loop is seamless; hovering pauses it. The duplicate
// is hidden from assistive tech so a screen reader hears each review once.
export function Testimonials() {
  return (
    <section id="reviews" className="scroll-mt-24 overflow-hidden py-20 lg:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="Reviews"
          title={<>Loved across <span className="text-gradient">180+ communities.</span></>}
          subtitle="From households that were tired of chasing their own laundry."
        />
      </div>

      <div className="group relative mt-14">
        {/* Soft edges so cards fade in and out rather than being clipped. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-background to-transparent sm:w-28" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-background to-transparent sm:w-28" />

        <div className="flex w-max animate-marquee gap-5 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          {testimonials.map((t) => (
            <Card key={`a-${t.name}`} t={t} />
          ))}
          {testimonials.map((t) => (
            <Card key={`b-${t.name}`} t={t} ariaHidden />
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({ t, ariaHidden }: { t: Testimonial; ariaHidden?: boolean }) {
  return (
    <figure
      aria-hidden={ariaHidden}
      className="flex w-80 shrink-0 flex-col rounded-3xl p-6 glass"
    >
      <div className="flex gap-0.5" aria-label={`${t.rating} out of 5 stars`}>
        {Array.from({ length: t.rating }).map((_, i) => (
          <Star key={i} className="size-4 fill-accent text-accent" aria-hidden="true" />
        ))}
      </div>
      <blockquote className="mt-4 flex-1 text-pretty text-sm leading-relaxed text-foreground/90">
        &ldquo;{t.quote}&rdquo;
      </blockquote>
      <figcaption className="mt-5 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-primary/15 font-display text-sm font-semibold text-primary ring-1 ring-primary/30">
          {t.name.split(" ").map((n) => n[0]).join("")}
        </span>
        <span>
          <span className="block text-sm font-medium">{t.name}</span>
          <span className="block text-xs text-muted-foreground">{t.unit}</span>
        </span>
      </figcaption>
    </figure>
  );
}
