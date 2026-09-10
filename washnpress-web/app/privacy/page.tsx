import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/site/legal-shell";
import { GrievanceOfficer, PlaceholderNotice } from "@/components/site/grievance-officer";
import { legal, LEGAL_DETAILS_ARE_PLACEHOLDER } from "@/lib/legal";

// Apple 5.1.1 and Google Play both require a privacy policy reachable at a public
// URL without signing in, and the Play listing links to this exact page. It is
// deliberately written from what the product actually collects — the fields the
// onboarding form asks for and the endpoints the app calls — rather than from a
// generic template, because a policy that describes data we do not hold is as much
// of a review problem as no policy at all.
export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Wash N Press collects, why, how long we keep it, and how to see, correct or delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      intro={`How ${legal.brandName} collects, uses, shares and retains your personal data, and the choices you have over it.`}
    >
      {LEGAL_DETAILS_ARE_PLACEHOLDER && <PlaceholderNotice />}

      <section>
        <h2>Who we are</h2>
        <p>
          {legal.entityName} (&ldquo;{legal.brandName}&rdquo;, &ldquo;we&rdquo;) operates the
          Wash N Press app and website, providing doorstep laundry, ironing, dry cleaning and
          car care to residents of gated communities. We are the data fiduciary for the
          personal data described here under India&rsquo;s Digital Personal Data Protection
          Act, 2023.
        </p>
      </section>

      <section>
        <h2>What we collect</h2>
        <p>Only what a pickup and a subscription actually need:</p>
        <ul>
          <li><strong>Your mobile number.</strong> It is how you sign in — we send a one-time code to it — and how an operator reaches you at the door.</li>
          <li><strong>Your name.</strong> So the person collecting knows who they are meeting.</li>
          <li><strong>Your address inside the community</strong> — society, tower, floor and flat. A pickup cannot happen without it.</li>
          <li><strong>Your email address,</strong> if you choose to add one. It is optional and used only for receipts and account notices.</li>
          <li><strong>Your orders</strong> — the slots you book, the garments an operator records at collection, the state of each order, and any support ticket you raise, including photographs you attach to it.</li>
          <li><strong>Your payments</strong> — wallet top-ups, subscription charges, refunds and the resulting balance. Card and UPI details are entered on the payment gateway&rsquo;s own page and are never sent to or stored by us.</li>
          <li><strong>Device notification tokens,</strong> if you allow push notifications, so we can tell you when an order moves.</li>
        </ul>
        <p>
          We do not collect location data in the background, we do not read your contacts, and
          we do not track you across other apps or websites.
        </p>
      </section>

      <section>
        <h2>Why we use it</h2>
        <ul>
          <li>To perform the service you asked for: scheduling, collecting, processing and returning your items.</li>
          <li>To take payment, apply your subscription allowance, and issue refunds.</li>
          <li>To keep you informed about your own orders.</li>
          <li>To answer support tickets and investigate complaints about a specific order.</li>
          <li>To meet legal, tax and accounting obligations.</li>
        </ul>
        <p>
          We do not sell your personal data, and we do not use it for advertising or profiling.
        </p>
      </section>

      <section>
        <h2>Who else sees it</h2>
        <ul>
          <li><strong>The operator and supervisor serving your society,</strong> who see your name, flat and order so that a collection and delivery can happen.</li>
          <li><strong>Our payment gateway,</strong> which receives the amount and an order reference in order to take the payment. It never receives your address or order contents.</li>
          <li><strong>Our notification provider,</strong> which receives a device token and the text of the notification.</li>
          <li><strong>A government authority,</strong> where we are required by law to disclose.</li>
        </ul>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <p>
          Order, payment and invoice records are retained for as long as tax and accounting law
          requires them, which in India is currently eight financial years. Everything else —
          your profile, address, notification tokens and support conversations — is deleted when
          you delete your account, or after two years of an account being inactive, whichever
          comes first.
        </p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>You can, at any time:</p>
        <ul>
          <li><strong>See and correct your details</strong> — Profile &rarr; Edit Profile in the app. Your society, tower and flat are changed by contacting support, because moving a resident affects who collects from you.</li>
          <li><strong>Delete your account and personal data</strong> — Profile &rarr; Delete Account in the app, or start the request at <Link className="text-primary hover:underline" href="/account/delete">washnpress.example/account/delete</Link>. See that page for exactly what is deleted and what we are obliged to keep.</li>
          <li><strong>Withdraw consent to notifications</strong> — turn them off in your device settings; the service continues to work.</li>
          <li><strong>Complain</strong> — to our Grievance Officer below, or to the Data Protection Board of India.</li>
        </ul>
      </section>

      <section>
        <h2>Security</h2>
        <p>
          Your session is a bearer token held on your own device and sent over HTTPS. Support
          attachments are served only to the account that owns them. Card and UPI credentials
          never reach our servers.
        </p>
      </section>

      <section>
        <h2>Children</h2>
        <p>
          The service is not directed at children under 18, and we do not knowingly create
          accounts for them. An account is opened against a mobile number held by the resident.
        </p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>
          When this policy changes materially we will tell you in the app before the change takes
          effect. The date at the top of this page always reflects the current version.
        </p>
      </section>

      <GrievanceOfficer />

      <p className="text-xs text-muted-foreground">
        General questions that are not complaints are best sent to{" "}
        <a className="text-primary hover:underline" href={`mailto:${legal.supportEmail}`}>{legal.supportEmail}</a>{" "}
        or raised as a support ticket in the app.
      </p>
    </LegalShell>
  );
}
