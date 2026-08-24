import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { ProcessingBatch, Reconciliation, ServiceRequestView, OrderDetail } from "../api/types";
import { theme, rupees, dateTime, titleCase } from "../theme";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill, Counter, ChoiceChips,
} from "../components/ui";
import { ConfirmDialog, Dropdown } from "../components/filters";

// The operator's side of the sixth round: confirming what actually turned up per
// Garment + Service combination, and then working each combination as its own batch.

// ------------------------------------------------ confirming what turned up

export function ReconcileScreen({ token, orderId, onDone, onBack }: {
  token: string; orderId: string; onDone: () => void; onBack: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [accepted, setAccepted] = useState<Record<string, number>>({});
  const [early, setEarly] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notDue, setNotDue] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const detail = await api.opsOrder(orderId, token);
      setOrder(detail.order);
      // Start from what the resident asked for; the operator changes what differs.
      const start: Record<string, number> = {};
      for (const line of detail.order.processing?.lines ?? []) {
        start[line.id] = line.acceptedQuantity ?? line.quantity;
      }
      setAccepted(start);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  // Recalculated by the backend as the operator types, so the figures on screen are
  // the figures that will be charged.
  const recalculate = useCallback(async (next: Record<string, number>) => {
    try {
      const lines = Object.entries(next).map(([lineId, acceptedQuantity]) => ({ lineId, acceptedQuantity }));
      setReconciliation((await api.opsReconcile(orderId, lines, token)).reconciliation);
    } catch { /* the figures simply stay as they were */ }
  }, [orderId, token]);

  useEffect(() => { if (Object.keys(accepted).length) recalculate(accepted); }, [accepted, recalculate]);

  const confirm = async () => {
    setWorking(true); setError(null); setNotDue(null);
    try {
      const lines = Object.entries(accepted).map(([lineId, acceptedQuantity]) => ({ lineId, acceptedQuantity }));
      await api.opsPickedUpLines(orderId, {
        lines,
        early: early || undefined,
        earlyReason: early ? earlyReason.trim() || "Agreed with the resident" : undefined,
      }, token);
      onDone();
    } catch (e) {
      const err = e as { code?: string; message: string };
      // A pickup that is not due yet is not a failure to explain away: it says when
      // the work can be done, and offers the early collection path.
      if (err.code === "pickup_not_due") setNotDue(err.message);
      else setError(err.message);
    } finally { setWorking(false); }
  };

  if (busy && !order) return <Loading />;

  const rows = reconciliation?.lines ?? [];
  const anyDifference = rows.some((r) => r.difference !== 0);

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Confirm what you received"
        subtitle={order?.orderCode ?? undefined}
        right={<Button label="‹ Back" variant="secondary" onPress={onBack} />}
      />
      <ErrorText error={error} />

      {notDue ? (
        <>
          <Notice tone="warn" text={notDue} />
          <Card>
            <Text style={styles.body}>
              If the resident has asked you to collect early, say so and it will be recorded
              against the order.
            </Text>
            <Field label="Why is this early?" value={earlyReason} onChangeText={setEarlyReason} placeholder="Resident asked us to take it now" />
            <Button
              label="Collect early"
              variant="secondary"
              disabled={working || !earlyReason.trim()}
              onPress={() => { setEarly(true); setTimeout(confirm, 0); }}
            />
          </Card>
        </>
      ) : null}

      <SectionTitle>Each garment and service</SectionTitle>
      {rows.length ? rows.map((row) => (
        <Card key={row.lineId}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{row.category}</Text>
            <Pill text={titleCase(row.status)} color={differenceColour(row.status)} />
          </View>
          <Text style={styles.meta}>{row.serviceName} · {rupees(row.unitPricePaise)} each</Text>
          <Row label="Resident said" value={row.requested} />
          <Counter
            label="You received"
            value={accepted[row.lineId] ?? 0}
            onChange={(next) => setAccepted({ ...accepted, [row.lineId]: Math.max(0, next) })}
          />
          {row.difference !== 0 ? (
            <Row
              label="Difference"
              value={`${row.difference > 0 ? "+" : ""}${row.difference}${row.additionalPaise ? ` · ${rupees(row.additionalPaise)} extra` : ""}`}
            />
          ) : null}
        </Card>
      )) : <Empty text="This order has no garment lines." />}

      {reconciliation ? (
        <Card>
          <Row label="Resident said" value={reconciliation.requestedTotal} />
          <Row label="You received" value={reconciliation.actualTotal} />
          {reconciliation.additionalPaise > 0 ? (
            <Row label="Extra to charge" value={rupees(reconciliation.additionalPaise)} />
          ) : null}
          {anyDifference ? (
            <Notice tone="warn" text="The counts do not match. Both numbers are kept on the order so this can be settled later." />
          ) : null}
        </Card>
      ) : null}

      <Button
        label="Confirm and collect"
        disabled={working || !rows.length}
        onPress={confirm}
      />
    </Screen>
  );
}

function differenceColour(status: string): string {
  if (status === "matched") return theme.success;
  if (status === "short") return theme.danger;
  return theme.amber;
}

// --------------------------------------------------------- working the batches

export function BatchesScreen({ token, orderId, onBack }: {
  token: string; orderId: string; onBack: () => void;
}) {
  const [batches, setBatches] = useState<ProcessingBatch[]>([]);
  const [failing, setFailing] = useState<ProcessingBatch | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setBatches((await api.opsBatches(orderId, token)).batches); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  const advance = async (batch: ProcessingBatch) => {
    if (!batch.currentStep || batch.currentStep === "qc") return;
    setWorking(true); setError(null); setNote(null);
    try {
      const result = await api.opsAdvanceBatch(orderId, batch.id, batch.currentStep, token);
      setBatches(result.batches);
      setNote(`${batch.currentStepLabel} finished for ${batch.quantity} × ${batch.category}.`);
    } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  };

  const pass = async (batch: ProcessingBatch) => {
    setWorking(true); setError(null); setNote(null);
    try {
      const result = await api.opsBatchQc(orderId, batch.id, true, undefined, token);
      setBatches(result.batches);
      setNote(`${batch.category} passed.`);
      if (result.order.state === "ready_for_delivery") setNote("Every batch is done. The order is ready for delivery.");
    } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  };

  const fail = async () => {
    if (!failing || !reason.trim()) return;
    setWorking(true); setError(null);
    try {
      const result = await api.opsBatchQc(orderId, failing.id, false, reason.trim(), token);
      setBatches(result.batches);
      setNote(`${failing.category} sent back.`);
      setFailing(null); setReason("");
    } catch (e) { setError((e as Error).message); setFailing(null); }
    finally { setWorking(false); }
  };

  if (busy && !batches.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Processing"
        subtitle="Each garment and service is its own batch"
        right={<Button label="‹ Back" variant="secondary" onPress={onBack} />}
      />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      {batches.length ? batches.map((batch, index) => (
        <Card key={batch.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>Batch {index + 1} · {batch.quantity} × {batch.category}</Text>
            <Pill text={batch.statusLabel} color={batchColour(batch.status)} />
          </View>
          <Text style={styles.meta}>{batch.serviceName}</Text>

          {/* The sequence this batch actually needs, not a fixed wash-then-iron list. */}
          <View style={styles.steps}>
            {batch.steps.map((step) => (
              <View key={step.step} style={styles.step}>
                <Text style={[
                  styles.stepMark,
                  step.done && styles.stepDone,
                  step.current && styles.stepCurrent,
                ]}>
                  {step.done ? "✓" : step.current ? "▶" : "○"}
                </Text>
                <Text style={[styles.stepLabel, step.current && styles.stepLabelCurrent]}>{step.label}</Text>
              </View>
            ))}
          </View>

          {batch.qcReason ? <Notice tone="warn" text={batch.qcReason} /> : null}

          {batch.status === "completed" ? (
            <Notice tone="good" text="Finished and passed." />
          ) : batch.currentStep === "qc" ? (
            <View style={styles.buttonRow}>
              <View style={{ flex: 1, marginRight: 6 }}>
                <Button label="Passed" disabled={working} onPress={() => pass(batch)} />
              </View>
              <View style={{ flex: 1, marginLeft: 6 }}>
                <Button label="Failed" variant="danger" disabled={working} onPress={() => setFailing(batch)} />
              </View>
            </View>
          ) : (
            <Button
              label={`Finish ${batch.currentStepLabel ?? ""}`}
              disabled={working}
              onPress={() => advance(batch)}
            />
          )}
        </Card>
      )) : <Empty text="Nothing to process yet. Confirm the pickup first." />}

      <ConfirmDialog
        visible={Boolean(failing)}
        title="Send this batch back?"
        message="Only this batch goes back. The others carry on."
        confirmLabel="Send back"
        destructive
        onConfirm={fail}
        onCancel={() => { setFailing(null); setReason(""); }}
      />
      {failing ? (
        <Card>
          <Field label="What was wrong?" value={reason} onChangeText={setReason} placeholder="Collar still marked" />
        </Card>
      ) : null}
    </Screen>
  );
}

function batchColour(status: string): string {
  if (status === "completed") return theme.success;
  if (status === "qc_failed") return theme.danger;
  if (status === "awaiting_qc") return theme.amber;
  if (status === "in_progress") return theme.aqua;
  return theme.muted;
}

// --------------------------------------------------------- other service jobs

export function ServiceJobsScreen({ token }: { token: string }) {
  const [requests, setRequests] = useState<ServiceRequestView[]>([]);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [mine, setMine] = useState(false);
  const [completing, setCompleting] = useState<ServiceRequestView | null>(null);
  const [actualHours, setActualHours] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try { setRequests((await api.opsServices(token, { status, mine: mine || undefined })).requests); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, mine]);
  useEffect(() => { load(); }, [load]);

  const act = async (what: string, run: () => Promise<unknown>) => {
    setError(null); setNote(null);
    try { await run(); setNote(what); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const complete = async () => {
    if (!completing) return;
    await act("Job completed.", () => api.opsCompleteService(
      completing.id,
      completing.estimatedHours !== null ? { actualHours } : {},
      token,
    ));
    setCompleting(null);
  };

  if (busy && !requests.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title="Other services" subtitle="Vehicle washing and at-home ironing" />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      <Dropdown
        label="Status"
        value={status}
        options={["requested", "assigned", "in_progress", "completed"].map((s) => ({ value: s, label: titleCase(s) }))}
        onChange={setStatus}
      />
      <ChoiceChips
        options={["all", "mine"]}
        value={mine ? "mine" : "all"}
        onChange={(next) => setMine(next === "mine")}
        labelOf={(v) => (v === "mine" ? "Assigned to me" : "Everyone")}
      />

      {requests.length ? requests.map((request) => (
        <Card key={request.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{request.offeringName}</Text>
            <Pill text={request.statusLabel} color={jobColour(request.status)} />
          </View>
          <Text style={styles.meta}>{request.kindLabel} · {dateTime(request.scheduledFor)}</Text>
          {request.vehicleType ? <Row label="Vehicle" value={[request.vehicleType, request.vehicleNumber].filter(Boolean).join(" · ")} /> : null}
          {request.address ? <Row label="Where" value={request.address} /> : null}
          {request.estimatedHours ? <Row label="Hours booked" value={request.estimatedHours} /> : null}
          <Row label={request.finalPaise !== null ? "Charged" : "Quoted"} value={rupees(request.payablePaise)} />

          {request.status === "requested" ? (
            <Button label="Take this job" onPress={() => act("Job taken.", () => api.opsAssignService(request.id, undefined, token))} />
          ) : null}
          {request.status === "assigned" ? (
            <Button label="Start" onPress={() => act("Job started.", () => api.opsStartService(request.id, token))} />
          ) : null}
          {request.status === "in_progress" ? (
            <Button label="Complete" onPress={() => { setCompleting(request); setActualHours(request.estimatedHours ?? 1); }} />
          ) : null}
        </Card>
      )) : <Empty text="No jobs here." />}

      {completing ? (
        <Card>
          <SectionTitle>Finish {completing.offeringName}</SectionTitle>
          {completing.estimatedHours !== null ? (
            <>
              <Counter label="Hours actually worked" value={actualHours} onChange={(n) => setActualHours(Math.max(0.5, n))} />
              <Text style={styles.meta}>
                Booked for {completing.estimatedHours}. The resident is charged for what it took.
              </Text>
            </>
          ) : (
            <Text style={styles.meta}>This is a fixed price job.</Text>
          )}
          <Button label="Mark completed" onPress={complete} />
          <Button label="Cancel" variant="secondary" onPress={() => setCompleting(null)} />
        </Card>
      ) : null}
    </Screen>
  );
}

function jobColour(status: string): string {
  if (status === "completed") return theme.success;
  if (status === "cancelled") return theme.muted;
  if (status === "in_progress") return theme.aqua;
  if (status === "assigned") return theme.amber;
  return theme.danger;
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  title: { fontSize: 15, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 6 },
  body: { fontSize: 13, color: theme.slate, lineHeight: 19 },
  buttonRow: { flexDirection: "row", marginTop: 8 },
  steps: { marginTop: 10, marginBottom: 6 },
  step: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  stepMark: { width: 22, fontSize: 13, color: theme.muted },
  stepDone: { color: theme.success },
  stepCurrent: { color: theme.aqua },
  stepLabel: { fontSize: 13, color: theme.muted },
  stepLabelCurrent: { color: theme.deepTeal, fontWeight: "700" },
});
