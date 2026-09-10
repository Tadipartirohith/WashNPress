import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/site/legal-shell";
import { GrievanceOfficer, PlaceholderNotice } from "@/components/site/grievance-officer";
import { legal, LEGAL_DETAILS_ARE_PLACEHOLDER } from "@/lib/legal";

// The terms a resident agrees to. Written against the rules the backend actually
// enforces — the two-hour slot cutoff, the one-hour free change window, the ₹99 and
// ₹49 fees, immediate cancellation with a prorated refund to the wallet — so that
// nothing here is a promise the software does not keep.
export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms on which Wash N Press provides laundry, ironing, dry cleaning and car care, including booking, cancellation, payment and refunds.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      intro={`The agreement between you and ${legal.entityName} when you book a service through the ${legal.brandName} app.`}
    >
      {LEGAL_DETAILS_ARE_PLACEHOLDER && <PlaceholderNotice />}

      <section>
        <h2>1. Who these terms are with</h2>
        <p>
          The service is provided by {legal.entityName}. Using the app or booking a service means
          you accept these terms and the{" "}
          <Link className="text-primary hover:underline" href="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>2. Your account</h2>
        <p>
          An account is opened against your mobile number and verified with a one-time code. You
          are responsible for the number staying in your control; anyone with access to it can
          sign in as you. Your society, tower and flat are set at registration from the structure
          your society has configured, and are changed only by contacting support.
        </p>
        <p>
          You may delete your account at any time from Profile &rarr; Delete Account, or from{" "}
          <Link className="text-primary hover:underline" href="/account/delete">our account deletion page</Link>.
        </p>
      </section>

      <section>
        <h2>3. Booking a pickup</h2>
        <p>
          You book a slot; you do not declare what you are sending. The operator records the
          services, categories and counts at your door, and that record is what you are charged
          against. A slot closes two hours before it starts and is not offered after that.
        </p>
      </section>

      <section>
        <h2>4. Changing or cancelling a booking</h2>
        <ul>
          <li>A booking may be cancelled or rescheduled free of charge within one hour of making it.</li>
          <li>After that hour, cancelling costs &#8377;99 and rescheduling costs &#8377;49. The fee is taken from your wallet; if the balance is short it stays outstanding against your account.</li>
          <li>Within two hours of the pickup window starting, a booking can no longer be cancelled or rescheduled — an operator is already routed to you.</li>
        </ul>
      </section>

      <section>
        <h2>5. Subscriptions</h2>
        <ul>
          <li>A plan runs for a monthly cycle and carries a garment allowance and a turnaround commitment. Garments beyond the allowance are charged at the per-item rate.</li>
          <li>Upgrading takes effect immediately: you pay the prorated difference, the allowance grows, and garments already collected this cycle stay counted against it.</li>
          <li>Downgrading takes effect at your next renewal date. Your current plan runs until then.</li>
          <li>Cancelling takes effect immediately. The unused portion of the current cycle is refunded to your wallet and the remaining allowance ends with it.</li>
        </ul>
      </section>

      <section>
        <h2>6. Payment</h2>
        <p>
          Charges are settled from your Wash N Press wallet. You add money to the wallet through
          our payment gateway; the balance is credited once the gateway confirms the payment, not
          at the moment you submit it. Wallet balance is credit towards services, is not
          transferable, and is not a deposit or a payment instrument.
        </p>
        <p>Prices shown are per household and exclude GST where applicable.</p>
      </section>

      <section>
        <h2>7. Refunds and claims about your items</h2>
        <p>
          If an item comes back damaged, or does not come back, raise a support ticket against
          that order with photographs. We investigate against the operator&rsquo;s collection
          record. A settled claim is refunded to your wallet or, where you ask for it and we
          agree, to the original payment method. Claims must be raised within 48 hours of
          delivery, while the order can still be reconstructed.
        </p>
        <p>
          Items are accepted on the understanding that ordinary cleaning carries ordinary risk.
          We ask that you do not send items whose value you would not accept a like-for-like
          replacement for, and that you empty pockets before collection.
        </p>
      </section>

      <section>
        <h2>8. What we ask of you</h2>
        <ul>
          <li>Be reachable during the window you booked. A failed pickup is recorded and may be rebooked.</li>
          <li>Do not send items that are hazardous, illegal, or contaminated.</li>
          <li>Treat the operator at your door civilly. We will close an account over abuse of our staff.</li>
        </ul>
      </section>

      <section>
        <h2>9. Suspension</h2>
        <p>
          We may suspend or close an account for non-payment, for abuse of our staff, or where
          the account is being used fraudulently. Where we do, any wallet balance not owed to us
          is returned.
        </p>
      </section>

      <section>
        <h2>10. Liability</h2>
        <p>
          Our liability for any order is limited to the value of that order and the settled value
          of the items in it. We are not liable for indirect or consequential loss. Nothing here
          limits liability that cannot be limited under Indian law, including under the Consumer
          Protection Act, 2019.
        </p>
      </section>

      <section>
        <h2>11. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of India and subject to the courts of Bengaluru,
          Karnataka. Before going to court, please raise the matter with our Grievance Officer
          below — that is what they are there for.
        </p>
      </section>

      <section>
        <h2>12. Changes</h2>
        <p>
          We will tell you in the app before a material change to these terms takes effect. The
          date at the top of this page reflects the current version.
        </p>
      </section>

      <GrievanceOfficer />
    </LegalShell>
  );
}
