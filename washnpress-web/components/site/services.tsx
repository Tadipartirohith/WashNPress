import { Check } from "lucide-react";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { Car, Iron, Suds, Washer, type ServiceTint } from "@/components/brand/illustrations";
import { SectionHeading } from "./section-heading";
import { services, type Service } from "@/lib/site-data";

// Each card shows its service's scene on that service's suds tint. A service with no
// scene of its own (subscriptions) shows its icon on the tint instead.
function ServiceArt({ s }: { s: Service }) {
  const t = s.title.toLowerCase();
  const [tint, scene]: [ServiceTint, React.ReactNode] =
    /car/.test(t) ? ["car", <Car key="car" animated className="w-44" />]
    : /iron/.test(t) ? ["iron", <Iron key="iron" animated className="w-32" />]
    : /laundry|wash/.test(t) ? ["laundry", <Washer key="washer" animated className="w-32" />]
    : ["laundry", <span key="icon" className="grid size-20 place-items-center rounded-full bg-card text-primary shadow-glass"><s.icon className="size-9" /></span>];
  return <Suds tint={tint} className="grid h-full place-items-center">{scene}</Suds>;
}

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
            className="group flex h-full flex-col overflow-hidden rounded-3xl glass bg-card transition-all duration-[180ms] hover:-translate-y-1 hover:border-primary/40"
          >
            <div className="relative h-40 overflow-hidden">
              <ServiceArt s={s} />
              <span className="absolute left-3 top-3 grid size-10 place-items-center rounded-xl bg-card text-primary glass-strong">
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
