import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { images } from "@/lib/images";

export function CtaBand() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
      <div className="relative overflow-hidden rounded-[2rem] p-8 glass-strong sm:p-14">
        <div className="absolute inset-0 -z-10">
          <Image src={images.carDetail.src} alt="" fill sizes="100vw" className="object-cover opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/85 to-background/40" />
        </div>

        <div className="max-w-2xl">
          <h2 className="text-balance font-display text-3xl font-bold leading-tight sm:text-5xl">
            Give the household its <span className="text-gradient">weekends back.</span>
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            Set up a plan in two minutes, book your first pickup, and never think about the
            laundry again. There&rsquo;s no lock-in and no card needed to look around.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/app">
                Open the app <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="#pricing">Compare plans</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
