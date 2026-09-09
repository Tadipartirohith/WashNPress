"use client";

import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Panel } from "@/components/portal/panel";
import { StatusBadge } from "@/components/portal/status-badge";
import { useAsync, useAction } from "@/lib/use-async";
import { useToast } from "@/components/portal/toast";
import { supervisorApi } from "@/lib/api/supervisor";

// Editing the supervisor's own name and email. The shell header used to show the
// name and a sign-out button and nothing else — the updateProfile API existed with
// no UI behind it. This is the missing editor, opened from the header, mirroring
// the mobile SupervisorProfileScreen. Society assignment stays admin-controlled and
// is shown read-only.
export function ProfileButton({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Edit profile"
        className="grid size-9 place-items-center rounded-full glass hover:ring-1 hover:ring-primary/30"
      >
        <UserCog className="size-4 text-muted-foreground" />
      </button>
      {open && <ProfileModal onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function ProfileModal({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const detail = useAsync(() => supervisorApi.profile(), []);
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const save = useAction(() => supervisorApi.updateProfile({ fullName, email }));

  useEffect(() => {
    if (detail.data) {
      setFullName(detail.data.profile.fullName ?? "");
      setEmail(detail.data.profile.email ?? "");
    }
  }, [detail.data]);

  const submit = async () => {
    try {
      await save.run();
      toast.push("Profile updated.");
      detail.reload();
      onSaved?.();
    } catch (e) { toast.push(e instanceof Error ? e.message : "Could not update profile", "danger"); }
  };

  return (
    <Modal open onClose={onClose} title="Your profile" description="Update your name and email. Your society assignment is controlled by the admin.">
      <Panel loading={detail.loading} error={detail.error} onRetry={detail.reload}>
        {detail.data && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="font-medium">{detail.data.profile.phone}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Society</dt><dd className="font-medium">{detail.data.profile.societyName ?? "None yet"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd><StatusBadge status={detail.data.profile.status} toneMap={{ active: "success", blocked: "danger" }} /></dd></div>
            </dl>
            <FormField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
            <FormField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            {save.error && <p className="text-sm text-danger">{save.error}</p>}
            <button onClick={submit} disabled={save.busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50">
              {save.busy ? "Saving…" : "Save changes"}
            </button>
          </div>
        )}
      </Panel>
    </Modal>
  );
}
