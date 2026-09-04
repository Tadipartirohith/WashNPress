import Link from "next/link";
import { Logo } from "@/components/ui/logo";

const groups = [
  {
    heading: "Services",
    links: [
      { label: "Laundry & wash-fold", href: "#services" },
      { label: "Car care", href: "#services" },
      { label: "Steam ironing", href: "#services" },
      { label: "Subscriptions", href: "#pricing" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "How it works", href: "#how" },
      { label: "Pricing", href: "#pricing" },
      { label: "Reviews", href: "#reviews" },
      { label: "Vendor dashboard", href: "/admin" },
    ],
  },
  {
    heading: "Get the app",
    links: [
      { label: "Customer app", href: "/app" },
      { label: "Book a pickup", href: "/app" },
      { label: "Track an order", href: "/app" },
      { label: "Support", href: "/app" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6">
      <div className="rounded-[2rem] p-8 glass sm:p-10">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Doorstep laundry, car care and ironing for gated communities — booked, tracked
              and subscribed from one app.
            </p>
          </div>
          {groups.map((g) => (
            <nav key={g.heading} aria-label={g.heading}>
              <h3 className="font-display text-sm font-semibold">{g.heading}</h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>&copy; {new Date().getFullYear()} WashNPress. A demonstration experience.</p>
          <p className="flex gap-5">
            <Link href="/app" className="hover:text-foreground">Privacy</Link>
            <Link href="/app" className="hover:text-foreground">Terms</Link>
            <Link href="/admin" className="hover:text-foreground">Vendor login</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
