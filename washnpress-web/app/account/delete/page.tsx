import type { Metadata } from "next";
import Link from "next/link";
import { LegalShell } from "@/components/site/legal-shell";
import { GrievanceOfficer } from "@/components/site/grievance-officer";
import { legal } from "@/lib/legal";

// Google Play's Data safety requirements ask for a publicly reachable URL, outside
// the app, that explains how to delete the account and what is deleted — reachable
// by someone who has already uninstalled the app and so cannot use the in-app path.
// This is that URL; the in-app path lives in Profile and does the same thing.
export const metadata: Metadata = {
  title: "Delete your account",
  description:
    "How to delete your Wash N Press account and personal data, what is removed immediately, and what we are required to keep.",
};

export default function DeleteAccountPage() {
  return (
    <LegalShell
      title="Delete your account"
      intro={`You can close your ${legal.brandName} account and have your personal data erased. Here is how, and exactly what happens to your data.`}
    >
      <section>
        <h2>From inside the app</h2>
        <p>
          Open the app, go to <strong>Profile</strong>, scroll to <strong>Delete Account</strong>,
          and confirm. This is the fastest route and needs nothing from us.
        </p>
        <p>
          <Link className="text-primary hover:underline" href="/app">Open the app &rarr;</Link>
        </p>
      </section>

      <section>
        <h2>If you have already uninstalled the app</h2>
        <p>
          Email{" "}
          <a className="text-primary hover:underline" href={`mailto:${legal.supportEmail}?subject=Account%20deletion%20request`}>
            {legal.supportEmail}
          </a>{" "}
          from any address, or call the number below, quoting the mobile number the account was
          opened with. We verify that the number is yours before deleting anything — otherwise
          anyone who knew your number could close your account.
        </p>
      </section>

      <section>
        <h2>What is deleted</h2>
        <ul>
          <li>Your name, email address and mobile number.</li>
          <li>Your residence details — society, tower, floor and flat — and the link between your flat and you.</li>
          <li>Your support tickets, the conversations in them and any photographs you attached.</li>
          <li>Your notification device tokens, so notifications stop immediately.</li>
          <li>Your saved preferences and pickup schedules.</li>
        </ul>
      </section>

      <section>
        <h2>What we have to keep, and for how long</h2>
        <p>
          Order, invoice and payment records are retained for eight financial years because tax
          and accounting law requires it. They are separated from your identity where the record
          still works without it, and are never used to contact you or to rebuild a profile.
        </p>
        <p>
          Deletion is not reversible, and it does not by itself refund anything. If you hold a
          wallet balance or an active subscription, cancel the subscription first — the unused
          part of the cycle is refunded to your wallet — and contact support to have the
          remaining balance returned, before you delete the account.
        </p>
      </section>

      <section>
        <h2>How long it takes</h2>
        <p>
          A request made in the app is acted on straight away. A request made by email or phone
          is acknowledged within {legal.grievanceOfficer.acknowledgeWithinHours} hours and
          completed within 30 days of us verifying that the account is yours.
        </p>
      </section>

      <GrievanceOfficer />
    </LegalShell>
  );
}
