import { SiteNav } from "@/components/site/site-nav";
import { SiteFooter } from "@/components/site/site-footer";
import { legal } from "@/lib/legal";

// The frame the three statutory pages share — privacy, terms and account deletion.
// They are ordinary reading documents, so they get one measured column rather than
// the marketing page's grid, and the same nav and footer so a reader is never
// stranded on a page with no way back.
//
// No typography plugin is installed, so the heading and paragraph rhythm is set
// here once with descendant selectors instead of every page repeating classes on
// every element.
export function LegalShell({ title, intro, children }: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteNav />
      <main id="main" className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-3 text-pretty text-base leading-relaxed text-muted-foreground">{intro}</p>
        <p className="mt-2 text-xs text-muted-foreground">Last updated {legal.policyUpdated}</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-foreground/90 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-foreground [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:leading-relaxed [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
