"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { Panel } from "@/components/portal/panel";
import { FormField } from "@/components/portal/form-field";
import { Button } from "@/components/ui/button";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { operationsApi } from "@/lib/api/operations";

export function ProfileTab() {
  const profile = useAsync(() => operationsApi.profile(), []);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const save = useAction(operationsApi.updateProfile);
  const toast = useToast();

  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.profile.fullName ?? "");
      setEmail(profile.data.profile.email ?? "");
    }
  }, [profile.data]);

  return (
    <Panel loading={profile.loading} error={profile.error} onRetry={profile.reload}>
      {profile.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl glass p-5">
            <h2 className="font-display text-lg font-bold">Your details</h2>
            <FormField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <FormField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FormField label="Phone" value={profile.data.profile.phone} disabled readOnly />
            <FormField label="Employee ID" value={profile.data.profile.employeeId ?? "—"} disabled readOnly />
            {save.error && <p className="text-sm text-danger">{save.error}</p>}
            <Button
              disabled={save.busy}
              onClick={() => save.run({ fullName: fullName.trim() || undefined, email: email.trim() || undefined }).then(() => { profile.reload(); toast.push("Profile updated"); })}
            >
              {save.busy ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
            </Button>
          </div>

          <div className="space-y-3 rounded-2xl glass p-5">
            <h2 className="font-display text-lg font-bold">Coverage</h2>
            <div className="space-y-2 text-sm">
              <p><span className="text-muted-foreground">Society</span> · {profile.data.profile.societyName ?? "Unassigned"}</p>
              <p><span className="text-muted-foreground">Supervisor</span> · {profile.data.profile.supervisorName ?? "None assigned"}</p>
              <p><span className="text-muted-foreground">Blocks covered</span> · {(profile.data.profile.blockNames ?? []).join(", ") || "None assigned"}</p>
              <p><span className="text-muted-foreground">Flats covered</span> · {profile.data.profile.flatsCovered ?? 0}</p>
              {profile.data.profile.verificationStatus && (
                <p className="flex items-center gap-1.5 text-success"><CheckCircle2 className="size-4" /> {profile.data.profile.verificationStatus}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
