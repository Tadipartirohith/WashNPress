"use client";

import * as React from "react";
import { Modal } from "./modal";
import { FormField } from "./form-field";

// I-111: resolving a support ticket, done the same way in all three staff portals.
//
// It used to be done three different ways and none of them was reliable. The
// operator's Resolve button returned early and silently when the note was empty, so
// pressing it looked like a no-op; the supervisor resolved from a status dropdown
// that never sent a note at all, so the backend filed the literal word "Resolved" as
// the resolution; and the admin's dialog simply disabled the button, which says
// "this is broken" rather than "type the note". All three could also fire twice on a
// double click, because `busy` is state and two clicks in the same tick both read it
// as false.
//
// So: one dialog. The note is mandatory and refusing it is a sentence, not a dead
// control; the request is sent at most once; and a failure shows what the server
// actually said instead of being swallowed.
export const RESOLUTION_REQUIRED = "Please enter a resolution note before resolving this issue.";

export function ResolveIssueDialog({
  onResolve,
  onResolved,
  onClose,
  children,
}: {
  /** Sends the resolution. Rejects with an ApiError whose message is human-readable. */
  onResolve: (resolution: string) => Promise<unknown>;
  /** Called once the backend has accepted it — close the dialog and refresh there. */
  onResolved: () => void;
  onClose: () => void;
  /** Extra fields a portal wants under the note (the admin's findings box). */
  children?: React.ReactNode;
}) {
  const [resolution, setResolution] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // A ref rather than `saving`, because a double click dispatches both handlers
  // before React has re-rendered with the new state — the second one would send a
  // second PATCH against a ticket the first one has already moved.
  const inFlight = React.useRef(false);

  const submit = async () => {
    const note = resolution.trim();
    if (!note) { setError(RESOLUTION_REQUIRED); return; }
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    try {
      await onResolve(note);
      onResolved();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Could not resolve this issue");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Resolve issue" description="Say what was done. The resident is told, and it is kept on the ticket.">
      <div className="space-y-4">
        <FormField
          as="textarea"
          label="Resolution note"
          required
          value={resolution}
          onChange={(e) => { setResolution(e.target.value); if (error === RESOLUTION_REQUIRED) setError(null); }}
          placeholder="How was this resolved?"
          error={error === RESOLUTION_REQUIRED ? error : undefined}
        />
        {children}
        {error && error !== RESOLUTION_REQUIRED && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={saving} className="flex-1 rounded-xl glass py-2.5 text-sm font-medium disabled:opacity-50">Cancel</button>
          {/* Enabled even with an empty note: the refusal is the sentence above, not
              a button that cannot be pressed and never says why. */}
          <button
            onClick={submit}
            disabled={saving}
            className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground shadow-glow disabled:opacity-50"
          >
            {saving ? "Resolving…" : "Resolve"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
