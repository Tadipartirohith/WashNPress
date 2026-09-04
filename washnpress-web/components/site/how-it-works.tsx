import Image from "next/image";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { SectionHeading } from "./section-heading";
import { steps } from "@/lib/site-data";
import { images } from "@/lib/images";

export function HowItWorks() {
  return (
    <section id="how" className="relative scroll-mt-24 overflow-hidden py-20 lg:py-28">
      {/* A community image, dimmed behind glass, to ground the four steps in a real place. */}
      <div className="absolute inset-0 -z-10">
        <Image src={images.community.src} alt="" fill sizes="100vw" className="object-cover opacity-20" />
        <div className="absolute inset-0 bg-background/70" />
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title={<>From your door and <span className="text-gradient">back again.</span></>}
          subtitle="Four steps, and you watch every one of them happen live in the app."
        />

        <ScrollReveal className="relative mt-14 grid gap-6 md:grid-cols-4" stagger={120}>
          {steps.map((s, i) => (
            <div key={s.title} className="relative rounded-3xl p-6 glass">
              <div className="flex items-center justify-between">
                <span className="grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30">
                  <s.icon className="size-6" />
                </span>
                <span className="font-display text-4xl font-bold text-foreground/10">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.description}</p>
            </div>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
