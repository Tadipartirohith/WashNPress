import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { api } from "../api/client";
import type { ProcessingBatch, Reconciliation, ServiceRequestView, OrderDetail, QcReasonOption, DiscrepancyReasonOption } from "../api/types";
import { theme, rupees, dateTime, titleCase } from "../theme";
import { isMeasured, formatQuantity, measurementLabel, parseMeasurement } from "../api/units";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill, Counter,
} from "../components/ui";
import { ConfirmDialog, Dropdown, FilterRow, type FilterValues } from "../components/filters";

// The operator's side of the sixth round: confirming what actually turned up per
// Garment + Service combination, and then working each combination as its own batch.

// ------------------------------------------------ confirming what turned up

export function ReconcileScreen({ token, orderId, onDone, onBack }: {
  token: string; orderId: string; onDone: () => void; onBack: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [accepted, setAccepted] = useState<Record<string, number>>({});
  // What the scale said, per line, as typed. Kept as text so a half-finished "3."
  // does not become a number the moment it is typed.
  const [measured, setMeasured] = useState<Record<string, string>>({});
  // Why the count differs from what the resident declared. Required whenever it does:
  // both numbers are real, and a mismatch is a discrepancy to be recorded rather than
  // something to resolve silently in the operator's favour.
  const [discrepancyReasons, setDiscrepancyReasons] = useState<DiscrepancyReasonOption[]>([]);
  const [discrepancyReason, setDiscrepancyReason] = useState<string | null>(null);
  const [discrepancyRemarks, setDiscrepancyRemarks] = useState("");
  const [early, setEarly] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notDue, setNotDue] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, reasons] = await Promise.all([
        api.opsOrder(orderId, token),
        api.opsDiscrepancyReasons(token),
      ]);
      setOrder(detail.order);
      setDiscrepancyReasons(reasons.reasons);
      // Start from what the resident asked for; the operator changes what differs.
      const start: Record<string, number> = {};
      const startMeasured: Record<string, string> = {};
      for (const line of detail.order.processing?.lines ?? []) {
        start[line.id] = line.acceptedQuantity ?? line.quantity;
        // A weighed line starts from what the resident estimated, and the operator
        // replaces it with what the scale actually says.
        const estimate = line.acceptedMeasuredQuantity ?? line.measuredQuantity;
        if (line.unit && line.unit !== "piece" && estimate) startMeasured[line.id] = String(estimate);
      }
      setAccepted(start);
      setMeasured(startMeasured);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  // Recalculated by the backend as the operator types, so the figures on screen are
  // the figures that will be charged.
  const payload = useCallback((counts: Record<string, number>, weights: Record<string, string>) =>
    Object.entries(counts).map(([lineId, acceptedQuantity]) => {
      const typed = weights[lineId];
      const value = typed ? Number(typed) : NaN;
      return {
        lineId, acceptedQuantity,
        // Only where something was actually measured. An empty box means the
        // operator had nothing to add, not that the bag weighs nothing.
        ...(Number.isFinite(value) && value > 0 ? { acceptedMeasuredQuantity: value } : {}),
      };
    }), []);

  const recalculate = useCallback(async (counts: Record<string, number>, weights: Record<string, string>) => {
    try {
      setReconciliation((await api.opsReconcile(orderId, payload(counts, weights), token)).reconciliation);
    } catch { /* the figures simply stay as they were */ }
  }, [orderId, token, payload]);

  useEffect(() => { if (Object.keys(accepted).length) recalculate(accepted, measured); }, [accepted, measured, recalculate]);

  // What the resident declared, against what is about to be confirmed.
  const declared = reconciliation?.requestedTotal ?? 0;
  const counted = reconciliation?.actualTotal ?? 0;
  const mismatch = Boolean(reconciliation) && declared > 0 && counted !== declared;
  const discrepancyProblems = (): string[] => {
    if (!mismatch) return [];
    const problems: string[] = [];
    if (!discrepancyReason) problems.push("Choose why the quantity differs.");
    if (!discrepancyRemarks.trim()) problems.push("Say what happened.");
    return problems;
  };

  const confirm = async () => {
    setWorking(true); setError(null); setNotDue(null);
    try {
      await api.opsPickedUpLines(orderId, {
        lines: payload(accepted, measured),
        early: early || undefined,
        earlyReason: early ? earlyReason.trim() || "Agreed with the resident" : undefined,
        ...(mismatch
          ? { discrepancyReason: discrepancyReason ?? undefined, discrepancyRemarks: discrepancyRemarks.trim() }
          : {}),
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
            label="Garments you received"
            value={accepted[row.lineId] ?? 0}
            onChange={(next) => setAccepted({ ...accepted, [row.lineId]: Math.max(0, next) })}
          />
          {row.unit && isMeasured(row.unit) ? (
            <>
              {/* Weighed rather than counted, so the bill follows the scale. The
                  resident's estimate is shown beside it, not used in place of it. */}
              <Row label="Resident estimated" value={formatQuantity(row.unit, row.requestedMeasured ?? 0)} />
              <Field
                label={measurementLabel(row.unit)}
                value={measured[row.lineId] ?? ""}
                onChangeText={(next) => setMeasured({ ...measured, [row.lineId]: next })}
                placeholder={row.unit === "kg" ? "3.4" : "2"}
                keyboardType="number-pad"
              />
              {row.measuredDifference ? (
                <Row
                  label="Against the estimate"
                  value={`${row.measuredDifference > 0 ? "+" : "−"}${formatQuantity(row.unit, Math.abs(row.measuredDifference))}`}
                />
              ) : null}
            </>
          ) : null}
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
          {mismatch ? (
            <Row
              label="Difference"
              value={counted < declared ? `${declared - counted} short` : `${counted - declared} extra`}
            />
          ) : null}
          {reconciliation.additionalPaise > 0 ? (
            <Row label="Extra to charge" value={rupees(reconciliation.additionalPaise)} />
          ) : null}
          {mismatch ? (
            <>
              {/* The operator must not be able to confirm a mismatched pickup without
                  saying why. Without that the resident is left with two missing
                  shirts and nobody to ask about them. */}
              <SectionTitle>Why does the quantity differ?</SectionTitle>
              <View style={styles.chipRow}>
                {discrepancyReasons.map((option) => (
                  <Button
                    key={option.key}
                    label={discrepancyReason === option.key ? `✓ ${option.label}` : option.label}
                    variant="secondary"
                    onPress={() => setDiscrepancyReason(option.key)}
                  />
                ))}
              </View>
              <Field
                label="Remarks — required"
                value={discrepancyRemarks}
                onChangeText={setDiscrepancyRemarks}
                placeholder="Only four shirts were handed over at the door"
              />
              <Notice text="Both numbers are kept on the order, and the resident is told, so this can be settled later rather than remembered." />
            </>
          ) : null}
          {anyDifference && !mismatch ? (
            <Notice tone="warn" text="The counts do not match on one line. Both numbers are kept on the order so this can be settled later." />
          ) : null}
        </Card>
      ) : null}

      <Button
        label="Confirm and collect"
        disabled={working || !rows.length || discrepancyProblems().length > 0}
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
  // The reasons a check can fail, and what each one means — from the backend, because
  // the reason decides where the work goes back to and that is not a decision a screen
  // should be keeping its own copy of.
  const [qcReasons, setQcReasons] = useState<QcReasonOption[]>([]);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [failing, setFailing] = useState<ProcessingBatch | null>(null);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [work, reasons] = await Promise.all([
        api.opsBatches(orderId, token),
        api.opsQcReasons(token),
      ]);
      setBatches(work.batches);
      setQcReasons(reasons.reasons);
    }
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

  const chosenReason = qcReasons.find((r) => r.key === failReason) ?? null;
  // What the form still needs, said before Submit is pressed rather than after.
  const failureProblems = (): string[] => {
    const problems: string[] = [];
    if (!chosenReason) problems.push("Choose the reason this failed.");
    if (!remarks.trim()) problems.push("Say what went wrong.");
    if (chosenReason?.evidenceRequired && !evidenceUrl.trim()) {
      problems.push(`${chosenReason.label} needs a photograph.`);
    }
    return problems;
  };

  const clearFailure = () => { setFailing(null); setFailReason(null); setRemarks(""); setEvidenceUrl(""); };

  const fail = async () => {
    if (!failing || failureProblems().length) return;
    setWorking(true); setError(null);
    try {
      const result = await api.opsBatchQc(orderId, failing.id, false, {
        reason: failReason!,
        remarks: remarks.trim(),
        ...(evidenceUrl.trim() ? { evidenceUrl: evidenceUrl.trim() } : {}),
      }, token);
      setBatches(result.batches);
      // Where the work actually went, said back rather than left to be discovered.
      const updated = result.batches.find((b) => b.id === failing.id);
      const last = updated?.qcFailures?.[updated.qcFailures.length - 1];
      setNote(last ? `${failing.category}: ${last.correctiveLabel.toLowerCase()}.` : `${failing.category} sent back.`);
      clearFailure();
    } catch (e) { setError((e as Error).message); clearFailure(); }
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
          {batch.heldFor ? (
            <Notice
              tone="warn"
              text={batch.heldFor === "supervisor"
                ? "Held for supervisor review. This is not going back through a machine."
                : "Held for investigation. A missing or wrong garment is not fixed by reprocessing."}
            />
          ) : null}
          {/* Every attempt, kept. "Failed twice" is a different fact from "failed",
              and the second one is the one a supervisor needs. */}
          {(batch.qcFailures?.length ?? 0) > 1 ? (
            <>
              <SectionTitle>Failed checks</SectionTitle>
              {batch.qcFailures!.map((failure) => (
                <Row
                  key={failure.attempt}
                  label={`Attempt ${failure.attempt} · ${failure.reasonLabel}`}
                  value={failure.correctiveLabel}
                />
              ))}
            </>
          ) : null}

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

      {/* A failure has to say why. The reason decides where the work goes back to —
          a stain is rewashed, a torn garment is not — so it is chosen rather than
          typed, and the remarks are required beside it. */}
      {failing ? (
        <Card>
          <SectionTitle>Why did {failing.category} fail?</SectionTitle>
          <View style={styles.chipRow}>
            {qcReasons.map((option) => (
              <Button
                key={option.key}
                label={failReason === option.key ? `✓ ${option.label}` : option.label}
                variant="secondary"
                onPress={() => setFailReason(option.key)}
              />
            ))}
          </View>
          <Field
            label="Remarks — required"
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Stain remains on the white shirt"
          />
          {chosenReason?.evidenceRequired ? (
            <>
              <Field
                label="Photograph — required"
                value={evidenceUrl}
                onChangeText={setEvidenceUrl}
                placeholder="Link to the photo you took"
              />
              <Notice tone="warn" text={`${chosenReason.label} is a claim about the garment, so a photograph is required.`} />
            </>
          ) : null}
          {chosenReason?.serious ? (
            <Notice tone="warn" text="This one goes to a supervisor and the resident is told, rather than simply being reprocessed." />
          ) : null}
          {failureProblems().length ? <Notice tone="warn" text={failureProblems().join(" ")} /> : null}
          <View style={styles.buttonRow}>
            <Button
              label="Submit QC failure"
              variant="danger"
              disabled={working || failureProblems().length > 0}
              onPress={fail}
            />
            <Button label="Cancel" variant="secondary" onPress={clearFailure} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

function batchColour(status: string): string {
  if (status === "completed") return theme.success;
  // Held is waiting on a person; failed is waiting on a machine. Both are stopped,
  // and they are not the same kind of stopped.
  if (status === "held") return theme.danger;
  if (status === "qc_failed") return theme.amber;
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

      <FilterRow
        specs={[
          {
            key: "status", label: "Status", allLabel: "All statuses",
            options: ["requested", "assigned", "in_progress", "completed"]
              .map((v) => ({ value: v, label: titleCase(v) })),
          },
          {
            key: "mine", label: "Assigned to", allLabel: "Everyone",
            options: [{ value: "mine", label: "Me" }],
          },
        ]}
        values={{ status, mine: mine ? "mine" : undefined }}
        onChange={(next: FilterValues) => { setStatus(next.status); setMine(next.mine === "mine"); }}
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
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
