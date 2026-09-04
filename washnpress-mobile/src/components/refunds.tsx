import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { RefundRequest } from "../api/types";
import { rupees, dateTime, titleCase, theme, space, type } from "../theme";
// theme flat colours: amber (warn), success (good), muted, deepTeal (heading ink).
import { Card, Row, SectionTitle, Button, Notice, Field, Empty, Pill, Screen } from "./ui";

// The refunds a supervisor or admin decides on. A supervisor sees their own
// societies'; an admin sees all — the backend scopes the list, so this screen only
// has to render it. The money moves on approve, and nothing at all on reject.

const STATUS_COLOR: Record<RefundRequest["status"], string> = {
  pending: theme.amber,
  approved: theme.success,
  rejected: theme.muted,
};

export function RefundsQueue({ token }: { token: string }) {
  const [requests, setRequests] = useState<RefundRequest[]>([]);
  const [onlyPending, setOnlyPending] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await api.refunds(token, onlyPending ? { status: "pending" } : {});
      setRequests(r.requests);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, onlyPending]);
  useEffect(() => { load(); }, [load]);

  const decide = async (request: RefundRequest, action: "approve" | "reject") => {
    setError(null); setNote(null);
    const decisionNote = notes[request.id]?.trim() || undefined;
    try {
      if (action === "approve") await api.approveRefund(request.id, decisionNote, token);
      else await api.rejectRefund(request.id, decisionNote, token);
      setNote(action === "approve"
        ? `Refund approved — ${rupees(request.amountPaise + request.taxPaise)} returned to the resident's wallet.`
        : "Refund request turned down.");
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <SectionTitle>Refund requests</SectionTitle>
      <View style={styles.filterRow}>
        <Button label="Pending" variant={onlyPending ? "primary" : "secondary"} onPress={() => setOnlyPending(true)} selected={onlyPending} />
        <Button label="All" variant={onlyPending ? "secondary" : "primary"} onPress={() => setOnlyPending(false)} selected={!onlyPending} />
      </View>
      {error ? <Notice text={error} tone="warn" /> : null}
      {note ? <Notice text={note} tone="good" /> : null}

      {requests.length === 0 ? (
        <Empty text={onlyPending ? "No refunds are waiting for a decision." : "No refund requests yet."} />
      ) : (
        requests.map((r) => (
          <Card key={r.id}>
            <View style={styles.head}>
              <Text style={styles.code}>{r.orderCode}</Text>
              <Pill text={titleCase(r.status)} color={STATUS_COLOR[r.status]} />
            </View>
            <Row label="Amount" value={rupees(r.amountPaise + r.taxPaise)} figure />
            {r.taxPaise > 0 ? <Row label="of which GST" value={rupees(r.taxPaise)} /> : null}
            <Row label="Reason" value={r.reason} />
            <Row label="Requested" value={dateTime(r.createdAt)} />
            {r.status !== "pending" ? (
              <>
                <Row label="Decided" value={r.decidedAt ? dateTime(r.decidedAt) : "—"} />
                {r.decisionNote ? <Row label="Note" value={r.decisionNote} /> : null}
              </>
            ) : (
              <>
                <Field
                  label="Note (optional)"
                  value={notes[r.id] ?? ""}
                  onChangeText={(v) => setNotes((n) => ({ ...n, [r.id]: v }))}
                  placeholder="Why this decision"
                />
                <View style={styles.actions}>
                  <Button label="Approve" onPress={() => decide(r, "approve")} />
                  <Button label="Reject" variant="danger" onPress={() => decide(r, "reject")} />
                </View>
              </>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

// The staff-side entry point: ask for a refund on an order whose charge has settled.
// Self-contained so it can sit inside the order's charges card without the screen
// around it having to thread a handler through. Renders nothing where there is
// nothing to refund — an unpaid, refunded, or uncharged order.
export function RefundRequestControl({ token, orderId, status }: { token: string; orderId: string; status: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === "refunded") return <Notice text="This charge has been refunded." tone="good" />;
  if (status !== "paid") return null;
  if (done) return <Notice text="Refund requested — awaiting approval by a supervisor or admin." tone="good" />;

  const submit = async () => {
    setError(null);
    if (!reason.trim()) { setError("Say why the money is being returned."); return; }
    try {
      await api.requestRefund({ orderId, reason: reason.trim() }, token);
      setDone(true);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <View style={styles.control}>
      {error ? <Notice text={error} tone="warn" /> : null}
      {open ? (
        <>
          <Field label="Reason for the refund" value={reason} onChangeText={setReason} placeholder="e.g. Garment returned damaged" />
          <View style={styles.actions}>
            <Button label="Submit request" onPress={submit} />
            <Button label="Cancel" variant="secondary" onPress={() => { setOpen(false); setReason(""); setError(null); }} />
          </View>
        </>
      ) : (
        <Button label="Request a refund" variant="secondary" onPress={() => setOpen(true)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  control: { marginTop: space.snug },
  filterRow: { flexDirection: "row", gap: space.snug, marginBottom: space.snug },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: space.tight },
  code: { ...type.subheading, color: theme.deepTeal },
  actions: { flexDirection: "row", gap: space.snug, marginTop: space.snug },
});
