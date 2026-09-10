import { Mail, Phone, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { legal, LEGAL_DETAILS_ARE_PLACEHOLDER, registeredAddressLine } from "@/lib/legal";

// The Rule 4(5) block: a named grievance officer, how to reach them, and the clock
// they are held to. It is rendered on the privacy page, the terms page, the
// account-deletion page and inside the resident app's Support screen, because the
// rule asks for it to be *displayed* — a resident who never opens the marketing site
// still has to be able to find it.
//
// Deliberately free of hooks so the client-side resident app can render the same
// component the static pages do, rather than a second copy that drifts.
export function GrievanceOfficer({ compact = false }: { compact?: boolean }) {
  const g = legal.grievanceOfficer;
  return (
    <section id="grievance" className={cn("scroll-mt-24", compact ? "rounded-2xl glass p-4" : "rounded-3xl glass p-6")}>
      <h2 className="flex items-center gap-2 font-display text-base font-bold">
        <ShieldCheck className="size-4 text-primary" /> Grievance Officer
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Named under Rule 4(5) of the Consumer Protection (E-Commerce) Rules, 2020.
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{g.name}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Designation</dt>
          <dd className="font-medium">{g.designation}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-medium">
            <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`mailto:${g.email}`}>
              <Mail className="size-3.5" /> {g.email}
            </a>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="font-medium">
            <a className="inline-flex items-center gap-1.5 text-primary hover:underline" href={`tel:${g.phone.replace(/\s/g, "")}`}>
              <Phone className="size-3.5" /> {g.phone}
            </a>
          </dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Registered entity</dt>
          <dd className="font-medium">{legal.entityName}</dd>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-muted-foreground">Registered address</dt>
          <dd className="font-medium">{registeredAddressLine}</dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-muted-foreground">
        We acknowledge every complaint within {g.acknowledgeWithinHours} hours of receiving it and
        aim to resolve it within {g.resolveWithinDays} days.
      </p>

      {LEGAL_DETAILS_ARE_PLACEHOLDER && <PlaceholderNotice />}
    </section>
  );
}

// Shown until the real entity details are filled in. Presenting an invented officer
// and address as genuine would be worse than admitting the fields are unfilled, and
// a visible notice is what makes anyone fill them in before submission.
export function PlaceholderNotice() {
  return (
    <p className="mt-4 rounded-xl bg-warning/10 p-3 text-xs text-warning">
      Placeholder details. The registered entity, address and grievance officer above are
      stand-ins pending incorporation records and must be replaced before this app is
      submitted to the App Store or Google Play.
    </p>
  );
}
