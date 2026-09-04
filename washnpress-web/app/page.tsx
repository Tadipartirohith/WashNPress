import { SiteNav } from "@/components/site/site-nav";
import { Hero } from "@/components/site/hero";
import { Services } from "@/components/site/services";
import { HowItWorks } from "@/components/site/how-it-works";
import { Pricing } from "@/components/site/pricing";
import { Testimonials } from "@/components/site/testimonials";
import { CtaBand } from "@/components/site/cta-band";
import { SiteFooter } from "@/components/site/site-footer";

export default function HomePage() {
  return (
    <>
      <SiteNav />
      <main id="main">
        <Hero />
        <Services />
        <HowItWorks />
        <Pricing />
        <Testimonials />
        <CtaBand />
      </main>
      <SiteFooter />
    </>
  );
}
