import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Button, Card, Field, Notice, SectionTitle } from "./ui";
import { ConfirmDialog } from "./filters";
import { theme, space, type } from "../theme";
import type { Issue } from "../api/types";

// Handing an issue to the supervisor.
//
// An operator could open an issue, read it, and reply to the resident — and that
// was the whole of it. There was no way to say "I cannot resolve this", so an
// issue that needed a supervisor either sat with the operator or was passed on by
// telling somebody out of band. The backend has always been able to do it, with
// the transition, the notification and the audit entry; the screen simply never
// offered it.
//
// Escalating is not a reply. It is offered beside the reply box rather than in
// place of it, because an operator who can still help should still be able to,
// and it asks before it acts: escalation moves the issue out of their hands and
// they do not get it back.

// Whether this issue is still the operator's to escalate.
//
// Not offered for something already escalated — the report is explicit that the
// action should not appear twice — nor for an issue that is finished.
export function canEscalate(issue: Pick<Issue, "status">): boolean {
  return !["escalated_supervisor", "escalated_admin", "resolved", "closed"].includes(issue.status);
}

export function EscalateBox({ issue, onEscalate }: {
  issue: Pick<Issue, "status">;
  onEscalate: (note: string) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canEscalate(issue)) return null;

  const escalate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onEscalate(note.trim());
      setAsking(false);
      setNote("");
    } finally {
      // Left open on failure: the issue stays where it was and the reason is on
      // screen, rather than the dialog closing as though it had worked.
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.row}>
        <Button label="Escalate to supervisor" variant="secondary" onPress={() => setAsking(true)} />
      </View>
      <ConfirmDialog
        visible={asking}
        title="Escalate this issue to the supervisor?"
        message="The supervisor takes over and answers the resident from here. You keep the whole conversation, but you will not be able to add to it."
        confirmLabel="Escalate to supervisor"
        busy={busy}
        onConfirm={escalate}
        onCancel={() => { setAsking(false); setNote(""); }}
      >
        <Field
          label="What could you not resolve?"
          value={note}
          onChangeText={setNote}
          placeholder="The stain did not come out and the resident wants a refund…"
        />
      </ConfirmDialog>
    </>
  );
}

// What an escalated issue says to whoever is looking at it afterwards.
export function EscalationNote({ issue }: { issue: Pick<Issue, "status"> }) {
  if (issue.status !== "escalated_supervisor" && issue.status !== "escalated_admin") return null;
  const to = issue.status === "escalated_admin" ? "an admin" : "the supervisor";
  return (
    <Notice
      tone="warn"
      text={`This issue is with ${to}. The conversation stays here for reference, and they answer the resident from now on.`}
    />
  );
}

const styles = StyleSheet.create({
  row: { marginTop: space.base },
});
