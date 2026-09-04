import Image from "next/image";
import { Check } from "lucide-react";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { SectionHeading } from "./section-heading";
import { services } from "@/lib/site-data";

export function Services() {
  return (
    <section id="services" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6 lg:py-28">
      <SectionHeading
        eyebrow="What we do"
        title={<>Four services, <span className="text-gradient">one doorstep.</span></>}
        subtitle="Laundry, car care and ironing, each priced the way it should be — and a subscription that ties them together."
      />

      <ScrollReveal className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" stagger={110}>
        {services.map((s) => (
          <article
            key={s.title}
            className="group flex h-full flex-col overflow-hidden rounded-3xl glass transition-all duration-300 hover:-translate-y-1 hover:border-primary/40"
          >
            <div className="relative h-40 overflow-hidden">
              <Image
                src={s.image.src}
                alt={s.image.alt}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent" />
              <span className="absolute left-3 top-3 grid size-10 place-items-center rounded-xl text-primary glass-strong">
                <s.icon className="size-5" />
              </span>
              {s.tag && (
                <span className="absolute right-3 top-3 rounded-full bg-accent/90 px-2.5 py-1 text-[11px] font-semibold text-accent-foreground">
                  {s.tag}
                </span>
              )}
            </div>

            <div className="flex flex-1 flex-col p-5">
              <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {s.points.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm text-foreground/90">
                    <Check className="size-4 shrink-0 text-primary" /> {p}
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </ScrollReveal>
    </section>
  );
}
