"use client";

import { Panel } from "@/components/portal/panel";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync } from "@/lib/use-async";
import { operationsApi } from "@/lib/api/operations";

// I-89: the operator's Profile is read-only. An operator can see who they are and the
// coverage assigned to them, but changes to either are made by Admin/Supervisor from
// their own portals — there are no inputs, edit icons or Save buttons here, and the
// backend refuses an operator's own profile/coverage update. This reads as an
// information dashboard, not a form.

// One read-only label/value pair.
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/50 py-2 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

export function ProfileTab() {
  const profile = useAsync(() => operationsApi.profile(), []);

  return (
    <Panel loading={profile.loading} error={profile.error} onRetry={profile.reload}>
      {profile.data && (() => {
        const p = profile.data.profile;
        return (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-xl font-bold">Profile</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">View your operator and assigned coverage details.</p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl glass p-5">
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Operator Details</h3>
                <Field label="Full Name" value={p.fullName} />
                <Field label="Phone" value={p.phone} />
                <Field label="Email" value={p.email} />
                <Field label="Employee ID" value={p.employeeId} />
              </div>

              <div className="rounded-2xl glass p-5">
                <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Coverage</h3>
                <Field label="Society / Community" value={p.societyName ?? "Unassigned"} />
                <Field label="Supervisor" value={p.supervisorName ?? "None assigned"} />
                <Field label="Blocks / Towers" value={(p.blockNames ?? []).join(", ") || "None assigned"} />
                <Field label="Flats Covered" value={p.flatsCovered ?? 0} />
                <div className="flex items-baseline justify-between gap-4 py-2">
                  <span className="text-sm text-muted-foreground">Status</span>
                  {p.verificationStatus
                    ? <StatusBadge status={p.verificationStatus.toLowerCase()} label={p.verificationStatus.charAt(0).toUpperCase() + p.verificationStatus.slice(1)}
                        toneMap={{ approved: "success", pending: "warning", suspended: "danger", inactive: "muted" }} />
                    : <span className="text-sm font-medium">—</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </Panel>
  );
}
