import { useCallback, useEffect, useState } from "react";
import { themed } from "../components/themed";
import { View, Text, Image, StyleSheet } from "react-native";
import { pickPhoto, type PickedPhoto } from "../components/support";
import { api, fetchImageAsDataUri } from "../api/client";
import { isConnectivityFailure } from "../api/request-rules";
import {
  QC_EVIDENCE_URL_PLACEHOLDER, qcBatchFailPayload, qcEvidenceProblem, qcEvidenceSatisfied,
} from "./operations-qc-rules";
import { OPERATIONS_PAGE } from "./operations-nav-rules";
import { serviceCancelAllowed } from "./operations-service-rules";
import type { OfflineQueue } from "../offline/queue";
import type { ProcessingBatch, Reconciliation, ServiceRequestView, OrderDetail, QcReasonOption, DiscrepancyReasonOption, GarmentService, GarmentSummary } from "../api/types";
import { font, theme, size, rupees, dateTime, titleCase } from "../theme";
import { Icon } from "../components/icon";
import { isMeasured, formatQuantity, measurementLabel } from "../api/units";
import { formatUnit } from "../unit-display";
import {
  Screen, PageTitle, SectionTitle, Card, Row, Button, Field, Empty, ErrorText, Notice,
  Loading, Pill, Counter,
} from "../components/ui";
import { ConfirmDialog, Dropdown, FilterRow, Toggle, type FilterValues } from "../components/filters";
import {
  deliveryActionFor, deliveryBlocked, deliveryCountMismatch, deliveryPayload,
} from "./operations-delivery-rules";
import {
  PREVIEW_FIRST, QUANTITY_CHANGED,
  bookedLinePayload, collectionConfirmDisabled, collectionPayload, collectionProblems,
  hasLineMismatch, previewKey, previewStatus,
} from "./operations-collection-rules";

// The operator's side of the sixth round: confirming what actually turned up per
// Garment + Service combination, and then working each combination as its own batch.

// ------------------------------------------------ confirming what turned up

export function ReconcileScreen({ token, orderId, queue, onQueued, onDone, onBack }: {
  token: string; orderId: string; queue?: OfflineQueue; onQueued?: () => void; onDone: () => void; onBack: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [preview, setPreview] = useState<Reconciliation | null>(null);
  const [previewedKey, setPreviewedKey] = useState<string | null>(null);
  const [summary, setSummary] = useState<GarmentSummary | null>(null);
  const [accepted, setAccepted] = useState<Record<string, number>>({});
  // What the scale said, per line, as typed. Kept as text so a half-finished "3."
  // does not become a number the moment it is typed.
  const [measured, setMeasured] = useState<Record<string, string>>({});
  const [discrepancyReasons, setDiscrepancyReasons] = useState<DiscrepancyReasonOption[]>([]);
  const [discrepancyReason, setDiscrepancyReason] = useState<string | null>(null);
  const [discrepancyRemarks, setDiscrepancyRemarks] = useState("");
  const [early, setEarly] = useState(false);
  const [earlyReason, setEarlyReason] = useState("");
  const [dueNow, setDueNow] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notDue, setNotDue] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<{ garmentCategories: string[]; garmentServices: GarmentService[] } | null>(null);
  const [collected, setCollected] = useState<{ category: string; serviceId: string; quantity: number }[]>([]);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const [detail, reasons, cfg, pickups] = await Promise.all([
        api.opsOrder(orderId, token),
        api.opsDiscrepancyReasons(token),
        // A config hiccup must only lose the category list, not block recording a
        // collection at all — the same degrade the old top-level call made.
        api.opsConfig(token).catch(() => ({
          garmentCategories: [] as string[], garmentServices: [] as GarmentService[],
          additionalGarmentRatePaise: 0, nonSubscriberGarmentRatePaise: 0, issueTypes: [] as string[],
        })),
        api.opsPickups(token).catch(() => ({ pickups: [] as { orderId: string | null; dueNow?: boolean }[] })),
      ]);
      setOrder(detail.order);
      setDiscrepancyReasons(reasons.reasons);
      const match = pickups.pickups.find((p) => p.orderId === orderId);
      setDueNow(match?.dueNow);
      const activeServices = cfg.garmentServices.filter((s) => s.isActive !== false);
      setConfig({ garmentCategories: cfg.garmentCategories, garmentServices: activeServices });
      const start: Record<string, number> = {};
      const startMeasured: Record<string, string> = {};
      const lines = detail.order.processing?.lines ?? [];
      for (const line of lines) {
        start[line.id] = line.acceptedQuantity ?? line.quantity;
        const estimate = line.acceptedMeasuredQuantity ?? line.measuredQuantity;
        if (line.unit && line.unit !== "piece" && estimate) startMeasured[line.id] = String(estimate);
      }
      setAccepted(start);
      setMeasured(startMeasured);
      setPreview(null);
      setPreviewedKey(null);
      setSummary(null);
      if (lines.length === 0) {
        setCollected([{ category: cfg.garmentCategories[0] ?? "", serviceId: activeServices[0]?.id ?? "", quantity: 1 }]);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [orderId, token]);
  useEffect(() => { load(); }, [load]);

  // The early-collection toggle only makes sense while the window has not opened
  // yet. If it opens (or the not-due notice clears) while ticked, drop the flag and
  // its reason rather than silently sending them with a now-ordinary, on-time
  // collection.
  const showEarlyNow = dueNow === false || Boolean(notDue);
  useEffect(() => {
    if (!showEarlyNow) { setEarly(false); setEarlyReason(""); }
  }, [showEarlyNow]);

  const bookedLines = bookedLinePayload(order?.processing?.lines ?? [], accepted, measured);
  const payloadKey = previewKey(bookedLines);
  const previewState = previewStatus({
    bookedLineCount: bookedLines.length,
    hasPreview: preview !== null,
    payloadKey,
    previewedKey,
  });
  const previewFresh = previewState === "fresh";
  const mismatch = hasLineMismatch(preview, previewFresh);

  const dropPreview = () => { setPreview(null); setSummary(null); };

  const draft = () => ({
    bookedLines,
    collected,
    early,
    earlyReason,
    mismatch,
    discrepancyReason,
    discrepancyRemarks,
    preview: previewState,
  });

  const runPreview = async () => {
    setPreviewing(true); setError(null);
    const key = payloadKey;
    try {
      const result = await api.opsReconcile(orderId, bookedLines, token);
      setPreview(result.reconciliation);
      setPreviewedKey(key);
      try {
        const items = (order?.processing?.lines ?? [])
          .map((l) => ({ category: l.category, quantity: accepted[l.id] ?? l.quantity }))
          .filter((i) => i.quantity > 0);
        setSummary((await api.opsPreviewGarments(orderId, items, token)).summary);
      } catch { setSummary(null); }
    } catch (e) {
      setError((e as Error).message || "Could not preview the split");
    } finally { setPreviewing(false); }
  };

  const confirm = async () => {
    const problems = collectionProblems(draft());
    if (problems.length) { setError(problems[0]); return; }
    setWorking(true); setError(null); setNotDue(null); setQueuedNotice(null);
    const body = collectionPayload(draft());
    try {
      await api.opsPickedUpLines(orderId, body, token);
      onDone();
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === "pickup_not_due") {
        setDueNow(false);
        setNotDue(err.message || "This pickup's window hasn't opened yet. Tick “Collect early” and say why, or come back later.");
      } else if (err.code === "reconciliation_required") {
        dropPreview();
        setError(err.message || QUANTITY_CHANGED);
      } else if (isConnectivityFailure(e) && queue) {
        await queue.enqueue("markPickedUp", { orderId, body });
        onQueued?.();
        setQueuedNotice("No signal. This collection is saved on the phone and sends itself as soon as there is one.");
      } else setError(err.message);
    } finally { setWorking(false); }
  };

  if (busy && !order) return <Loading />;

  const booked = order?.processing?.lines ?? [];
  const showEarly = showEarlyNow;
  const previewHint = previewState === "stale" ? QUANTITY_CHANGED
    : previewState === "missing" ? PREVIEW_FIRST
    : null;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title="Confirm what you received"
        subtitle={order?.orderCode ?? undefined}
        right={<Button label="‹ Back" variant="secondary" onPress={onBack} />}
      />
      <ErrorText error={error} />
      {queuedNotice ? <Notice tone="good" text={queuedNotice} /> : null}

      <SectionTitle>{booked.length ? "Each garment and service" : "Record what you collected"}</SectionTitle>
      {booked.length ? booked.map((line) => (
        <Card key={line.id}>
          <Text style={styles.title}>{line.category}</Text>
          <Text style={styles.meta}>
            {line.serviceName} · requested {line.quantity}
            {line.unit && line.unit !== "piece" ? ` (${line.measuredQuantity ?? "—"} ${line.unit})` : ""}
          </Text>
          <Counter
            label="Garments you received"
            value={accepted[line.id] ?? line.quantity}
            onChange={(next) => {
              setAccepted({ ...accepted, [line.id]: Math.max(0, next) });
              dropPreview();
            }}
          />
          {line.unit && line.unit !== "piece" ? (
            <>
              <Row label="Resident estimated" value={formatQuantity(line.unit, line.measuredQuantity ?? 0)} />
              <Field
                label={isMeasured(line.unit) ? measurementLabel(line.unit) : `Measured (${line.unit})`}
                value={measured[line.id] ?? ""}
                onChangeText={(next) => {
                  setMeasured({ ...measured, [line.id]: next });
                  dropPreview();
                }}
                placeholder={line.unit === "kg" ? "3.4" : "2"}
                keyboardType="number-pad"
              />
            </>
          ) : null}
        </Card>
      )) : (
        <>
          {collected.map((r, i) => (
            <Card key={i}>
              <Dropdown
                label="Garment"
                value={r.category || undefined}
                allowClear={false}
                options={(config?.garmentCategories ?? []).map((c) => ({ value: c, label: c }))}
                onChange={(v) => setCollected(collected.map((x, xi) => (xi === i ? { ...x, category: v ?? "" } : x)))}
              />
              <Dropdown
                label="Service"
                value={r.serviceId || undefined}
                allowClear={false}
                options={(config?.garmentServices ?? []).map((s) => ({ value: s.id, label: s.name }))}
                onChange={(v) => setCollected(collected.map((x, xi) => (xi === i ? { ...x, serviceId: v ?? "" } : x)))}
              />
              <Counter
                label="Garments received"
                value={r.quantity}
                onChange={(n) => setCollected(collected.map((x, xi) => (xi === i ? { ...x, quantity: Math.max(1, n) } : x)))}
              />
              {collected.length > 1 ? (
                <Button label="Remove" variant="secondary" onPress={() => setCollected(collected.filter((_, xi) => xi !== i))} />
              ) : null}
            </Card>
          ))}
          <Button
            label="Add garment"
            variant="secondary"
            onPress={() => setCollected([...collected, { category: config?.garmentCategories[0] ?? "", serviceId: config?.garmentServices[0]?.id ?? "", quantity: 1 }])}
          />
        </>
      )}

      {showEarly ? (
        <Card>
          <Notice tone="warn" text={notDue || "This pickup's window hasn't opened yet."} />
          <Toggle
            label="Collect early anyway"
            value={early}
            onChange={setEarly}
            hint="Required when collecting before the window opens."
          />
          {early ? (
            <Field
              label="Early collection reason"
              value={earlyReason}
              onChangeText={setEarlyReason}
              placeholder="Why collect before the window opens?"
            />
          ) : null}
        </Card>
      ) : null}

      {booked.length > 0 ? (
        <Button label={previewing ? "Previewing…" : "Preview split"} variant="secondary" disabled={previewing || working} onPress={() => { void runPreview(); }} />
      ) : null}

      {preview && previewFresh ? (
        <Card>
          {preview.lines.map((row) => (
            <View key={row.lineId} style={styles.headRow}>
              <Text style={styles.body}>{row.category} · {row.serviceName}</Text>
              <Pill text={titleCase(row.status)} color={differenceColour(row.status)} />
            </View>
          ))}
          <Row label="Resident said" value={preview.requestedTotal} />
          <Row label="You received" value={preview.actualTotal} />
          {mismatch ? (
            <Row
              label="Difference"
              value={preview.actualTotal < preview.requestedTotal
                ? `${preview.requestedTotal - preview.actualTotal} short`
                : `${preview.actualTotal - preview.requestedTotal} extra`}
            />
          ) : null}
          {summary ? (
            <>
              <Row label="Total garments" value={summary.acceptedCount} />
              {summary.planTier ? <Row label="Covered by plan" value={summary.subscriptionCoveredCount} /> : null}
              <Row label="Additional / chargeable" value={summary.additionalCount} />
            </>
          ) : null}
          <Row label="Additional charge" value={rupees(preview.additionalPaise)} />
        </Card>
      ) : null}

      {preview && mismatch ? (
        <Card>
          <Notice tone="warn" text={`Expected ${preview.requestedTotal}, collected ${preview.actualTotal} — record why the quantity differs.`} />
          <SectionTitle>Why does the quantity differ?</SectionTitle>
          <View style={styles.chipRow}>
            {discrepancyReasons.map((option) => (
              <Button
                key={option.key}
                label={option.label}
                selected={discrepancyReason === option.key}
                variant="secondary"
                onPress={() => setDiscrepancyReason(option.key)}
              />
            ))}
          </View>
          <Field
            label="What happened"
            value={discrepancyRemarks}
            onChangeText={setDiscrepancyRemarks}
            placeholder="Only four shirts were handed over at the door"
          />
        </Card>
      ) : null}

      {previewHint ? <Notice tone={previewState === "stale" ? "warn" : undefined} text={previewHint} /> : null}

      <Button
        label="Confirm Collection"
        disabled={working || previewing || collectionConfirmDisabled(draft())}
        onPress={() => { void confirm(); }}
      />
    </Screen>
  );
}

function differenceColour(status: string): string {
  if (status === "matched") return theme.success;
  if (status === "short") return theme.danger;
  return theme.amber;
}

// The photo attached to a QC failure. Private, like the order it is about, so it is
// fetched with the session and rendered from memory rather than pointed at by a URL
// anybody holding the link could follow.
function QcEvidence({ url, token }: { url: string; token: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchImageAsDataUri(url, token)
      .then((data) => { if (live) setUri(data); })
      .catch(() => { if (live) setUri(null); });
    return () => { live = false; };
  }, [url, token]);
  if (!uri) return null;
  return <Image source={{ uri }} style={styles.qcEvidenceImage} resizeMode="cover" accessibilityLabel="Photo of the fault" />;
}

// --------------------------------------------------------- working the batches

export function BatchesScreen({ token, orderId, queue, onQueued, onBack }: {
  token: string; orderId: string; queue?: OfflineQueue; onQueued?: () => void; onBack: () => void;
}) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [batches, setBatches] = useState<ProcessingBatch[]>([]);
  // The reasons a check can fail, and what each one means — from the backend, because
  // the reason decides where the work goes back to and that is not a decision a screen
  // should be keeping its own copy of.
  const [qcReasons, setQcReasons] = useState<QcReasonOption[]>([]);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  // The photo the operator takes of the fault, held until the failure is submitted.
  const [evidencePhoto, setEvidencePhoto] = useState<PickedPhoto | null>(null);
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [failing, setFailing] = useState<ProcessingBatch | null>(null);
  const [deliveryCount, setDeliveryCount] = useState("");
  const [deliveryReason, setDeliveryReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const applyOrder = (next: OrderDetail, nextBatches?: ProcessingBatch[]) => {
    setOrder(next);
    if (nextBatches) setBatches(nextBatches);
    if (next.state === "out_for_delivery") {
      setDeliveryCount((current) => current || String(next.acceptedCount ?? 0));
    }
  };

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // The order is loaded with the batches so this screen can offer the same
      // out-for-delivery / mark-delivered / reassign actions the web BatchDrawer
      // keeps beside the pipeline. Batches alone do not say when the bag is ready
      // to go out.
      const [detail, work, reasons] = await Promise.all([
        api.opsOrder(orderId, token),
        api.opsBatches(orderId, token),
        api.opsQcReasons(token),
      ]);
      applyOrder(detail.order, work.batches);
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
      applyOrder(result.order, result.batches);
      setNote(`${batch.currentStepLabel} finished for ${batch.quantity} × ${batch.category}.`);
    } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  };

  const pass = async (batch: ProcessingBatch) => {
    setWorking(true); setError(null); setNote(null);
    try {
      const result = await api.opsBatchQc(orderId, batch.id, true, undefined, token);
      applyOrder(result.order, result.batches);
      setNote(result.order.state === "ready_for_delivery"
        ? "Every batch is done. The order is ready for delivery."
        : `${batch.category} passed.`);
    } catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  };

  const chosenReason = qcReasons.find((r) => r.key === failReason) ?? null;
  // What the form still needs, said before Submit is pressed rather than after.
  const failureProblems = (): string[] => {
    const problems: string[] = [];
    if (!chosenReason) problems.push("Choose the reason this failed.");
    if (!remarks.trim()) problems.push("Say what went wrong.");
    if (!qcEvidenceSatisfied({
      evidenceRequired: Boolean(chosenReason?.evidenceRequired),
      photo: evidencePhoto,
      evidenceUrl,
    })) {
      problems.push(qcEvidenceProblem(chosenReason!.label));
    }
    return problems;
  };

  const clearFailure = () => { setFailing(null); setFailReason(null); setRemarks(""); setEvidencePhoto(null); setEvidenceUrl(""); setPhotoError(null); };

  const addPhoto = async () => {
    setPhotoError(null);
    try {
      const picked = await pickPhoto();
      if (picked) setEvidencePhoto(picked);
    } catch (e) { setPhotoError((e as Error).message); }
  };

  const fail = async () => {
    if (!failing || failureProblems().length) return;
    setWorking(true); setError(null);
    try {
      const result = await api.opsBatchQc(orderId, failing.id, false, qcBatchFailPayload({
        reason: failReason!,
        remarks,
        evidenceUrl,
        evidencePhoto,
      }), token);
      applyOrder(result.order, result.batches);
      // Where the work actually went, said back rather than left to be discovered.
      const updated = result.batches.find((b) => b.id === failing.id);
      const last = updated?.qcFailures?.[updated.qcFailures.length - 1];
      setNote(last ? `${failing.category}: ${last.correctiveLabel.toLowerCase()}.` : `${failing.category} sent back.`);
      clearFailure();
    } catch (e) { setError((e as Error).message); clearFailure(); }
    finally { setWorking(false); }
  };

  const sendOut = async () => {
    setWorking(true); setError(null); setNote(null);
    try {
      applyOrder((await api.outForDelivery(orderId, token)).order);
      setNote("Sent out for delivery.");
    } catch (e) {
      if (isConnectivityFailure(e) && queue) {
        await queue.enqueue("outForDelivery", { orderId });
        onQueued?.();
        setNote("No signal. This is saved on the phone and sends itself as soon as there is one.");
      } else setError((e as Error).message);
    } finally { setWorking(false); }
  };

  const markDelivered = async () => {
    if (deliveryBlocked(deliveryCount, order?.acceptedCount, deliveryReason)) return;
    setWorking(true); setError(null); setNote(null);
    const body = deliveryPayload(deliveryCount, order?.acceptedCount, deliveryReason);
    try {
      applyOrder((await api.deliver(
        orderId,
        body.deliveryCount,
        body.discrepancyReason,
        token,
      )).order);
      setNote("Order delivered.");
      setDeliveryReason("");
    } catch (e) {
      if (isConnectivityFailure(e) && queue) {
        await queue.enqueue("deliver", { orderId, deliveryCount: body.deliveryCount, discrepancyReason: body.discrepancyReason });
        onQueued?.();
        setNote("No signal. This delivery is saved on the phone and sends itself as soon as there is one.");
        setDeliveryReason("");
      } else setError((e as Error).message);
    } finally { setWorking(false); }
  };

  const deliveryAction = deliveryActionFor(order?.state);
  const countMismatch = deliveryAction === "deliver" && deliveryCountMismatch(deliveryCount, order?.acceptedCount);

  if (busy && !order && !batches.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle
        title={order?.orderCode ?? "Processing"}
        subtitle="Each garment and service is its own batch"
        right={<Button label="‹ Back" variant="secondary" onPress={onBack} />}
      />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      {order && !["delivered", "cancelled"].includes(order.state) ? (
        <BatchReassign token={token} order={order} onDone={load} />
      ) : null}

      {order ? (
        <Card>
          <Row label="Resident" value={[order.residentName, formatUnit(order.blockName, order.unitNumber), order.societyName].filter(Boolean).join(" · ") || null} />
          <Row label="Accepted" value={order.acceptedCount} figure />
          <Row label="Additional charge" value={rupees(order.additionalChargePaise ?? 0)} figure />
          <Row label="Picked up" value={order.pickedUpAt ? dateTime(order.pickedUpAt) : null} />
        </Card>
      ) : null}

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
                <View style={styles.stepMark}>
                  <Icon
                    name={step.done ? "checkCircle" : step.current ? "chevronRight" : "circle"}
                    size={size.icon.sm}
                    color={step.done ? theme.feedback.successText : step.current ? theme.brand.solid : theme.text.tertiary}
                    strokeWidth={step.current ? 2.5 : 2}
                  />
                </View>
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
          {/* Every failed check, kept and shown whole: the reason, the operator's
              remarks in their own words, the photo of the fault where one was taken,
              and where the work went. "Failed twice" is a different fact from "failed",
              and reading the remarks and the picture is how the next person acts on it
              without having to ask. */}
          {batch.qcFailures?.length ? (
            <>
              <SectionTitle>Failed checks</SectionTitle>
              {batch.qcFailures.map((failure) => (
                <View key={failure.attempt} style={styles.qcFailure}>
                  <View style={styles.headRow}>
                    <Text style={styles.qcFailureReason}>Attempt {failure.attempt} · {failure.reasonLabel}</Text>
                    <Text style={styles.meta}>{dateTime(failure.at)}</Text>
                  </View>
                  {failure.remarks ? <Text style={styles.qcFailureRemarks}>{failure.remarks}</Text> : null}
                  {failure.evidenceUrl ? <QcEvidence url={failure.evidenceUrl} token={token} /> : null}
                  <Text style={styles.meta}>{failure.correctiveLabel}</Text>
                </View>
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
      )) : <Empty text="Nothing to process yet. Confirm the pickup first." scene={false} />}

      {deliveryAction === "out_for_delivery" ? (
        <Button label="Send out for delivery" disabled={working} onPress={sendOut} />
      ) : null}

      {deliveryAction === "deliver" ? (
        <Card>
          <SectionTitle>Confirm delivery count</SectionTitle>
          <Notice text={`Accepted at pickup: ${order?.acceptedCount ?? "—"}. A different count needs a documented reason.`} />
          <Field
            label="Items being delivered"
            value={deliveryCount}
            onChangeText={setDeliveryCount}
            keyboardType="number-pad"
          />
          {countMismatch ? (
            <Field
              label="This differs from what was accepted at pickup — why?"
              value={deliveryReason}
              onChangeText={setDeliveryReason}
            />
          ) : null}
          <Button
            label="Mark delivered"
            disabled={working || deliveryBlocked(deliveryCount, order?.acceptedCount, deliveryReason)}
            onPress={markDelivered}
          />
        </Card>
      ) : null}

      {order?.state === "delivered" ? (
        <Notice tone="good" text="This order has been delivered." />
      ) : null}

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
                label={option.label}
                selected={failReason === option.key}
                variant="secondary"
                onPress={() => setFailReason(option.key)}
              />
            ))}
          </View>
          <Field
            label="Remarks (required)"
            value={remarks}
            onChangeText={setRemarks}
            placeholder="Stain remains on the white shirt"
          />
          {chosenReason?.evidenceRequired ? (
            <View style={styles.evidenceBlock}>
              <Text style={styles.evidenceLabel}>{chosenReason.label} needs a photograph</Text>
              {evidencePhoto ? (
                <View style={styles.evidenceRow}>
                  <Image
                    source={{ uri: `data:${evidencePhoto.contentType};base64,${evidencePhoto.data}` }}
                    style={styles.evidenceThumb}
                    resizeMode="cover"
                    accessibilityLabel={evidencePhoto.filename}
                  />
                  <Button label="Retake" variant="secondary" onPress={addPhoto} />
                  <Button label="Remove" variant="secondary" onPress={() => setEvidencePhoto(null)} />
                </View>
              ) : (
                <Button label="Add photo" variant="secondary" onPress={addPhoto} />
              )}
              {photoError ? <Notice tone="warn" text={photoError} /> : null}
              <Field
                label={QC_EVIDENCE_URL_PLACEHOLDER}
                value={evidenceUrl}
                onChangeText={setEvidenceUrl}
                placeholder={QC_EVIDENCE_URL_PLACEHOLDER}
              />
            </View>
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

// The same reassign the web BatchDrawer keeps on a batched order. Duplicated here
// rather than imported from the portal file, which already imports this module.
function BatchReassign({ token, order, onDone }: { token: string; order: OrderDetail; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [operators, setOperators] = useState<{ userId: string; fullName: string | null; phone: string }[]>([]);
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expand = async () => {
    setOpen(true); setError(null);
    try { setOperators((await api.opsAssignableOperators(token)).operators); }
    catch (e) { setError((e as Error).message); }
  };

  const assign = async (userId: string) => {
    setBusy(true); setError(null);
    try {
      await api.opsAssignOrder(order.id, userId, token);
      setOpen(false); setChoice(undefined);
      await onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  if (!open) {
    return (
      <Card>
        <View style={styles.headRow}>
          <Text style={styles.meta}>{order.operatorName ? `Assigned to ${order.operatorName}` : "Unassigned"}</Text>
          <Button label={order.operatorName ? "Reassign" : "Assign"} variant="secondary" onPress={expand} />
        </View>
      </Card>
    );
  }

  return (
    <Card>
      <SectionTitle>Reassign this order</SectionTitle>
      <Dropdown
        label="Operator"
        value={choice}
        allLabel="Choose an operator"
        options={operators.map((o) => ({ value: o.userId, label: o.fullName ?? o.phone }))}
        onChange={(v) => { setChoice(v); if (v) assign(v); }}
      />
      <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => { setOpen(false); setChoice(undefined); }} />
      <ErrorText error={error} />
    </Card>
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
  const [offerings, setOfferings] = useState<{ id: string; name: string }[]>([]);
  const [operators, setOperators] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [offeringId, setOfferingId] = useState<string | undefined>(undefined);
  const [assignedToUserId, setAssignedToUserId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [completing, setCompleting] = useState<ServiceRequestView | null>(null);
  const [cancelling, setCancelling] = useState<ServiceRequestView | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      // The service filter and assigned-to list come with the bookings, populated
      // from the admin-configured services and the operators on this operator's
      // societies — the operator never maintains a service list of their own.
      const r = await api.opsServices(token, { status, offeringId, assignedToUserId, date, q: search.trim() || undefined });
      setRequests(r.requests); setOfferings(r.offerings ?? []); setOperators(r.operators ?? []);
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [token, status, offeringId, assignedToUserId, date, search]);
  useEffect(() => { load(); }, [load]);

  const act = async (what: string, run: () => Promise<unknown>) => {
    setError(null); setNote(null);
    try { await run(); setNote(what); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const complete = async () => {
    if (!completing) return;
    await act("Job completed.", () => api.opsCompleteService(completing.id, {}, token));
    setCompleting(null);
  };

  const cancelBooking = async () => {
    if (!cancelling) return;
    await act("Booking cancelled.", () => api.opsCancelService(cancelling.id, cancelReason.trim() || undefined, token));
    setCancelling(null); setCancelReason("");
  };

  const today = new Date().toISOString().slice(0, 10);

  if (busy && !requests.length) return <Loading />;

  return (
    <Screen refreshing={busy} onRefresh={load}>
      <PageTitle title={OPERATIONS_PAGE.services.title} subtitle={OPERATIONS_PAGE.services.subtitle} />
      <ErrorText error={error} />
      {note ? <Notice tone="good" text={note} /> : null}

      <FilterRow
        specs={[
          {
            key: "status", label: "Status", allLabel: "All statuses",
            options: ["requested", "assigned", "in_progress", "completed", "cancelled"]
              .map((v) => ({ value: v, label: titleCase(v) })),
          },
          { key: "offeringId", label: "Service", allLabel: "All services", options: offerings.map((o) => ({ value: o.id, label: o.name })) },
          { key: "assignedToUserId", label: "Assigned to", allLabel: "Everyone", options: operators.map((o) => ({ value: o.id, label: o.name })) },
          { key: "date", label: "Date", allLabel: "Any date", options: [{ value: today, label: "Today" }] },
        ]}
        values={{ status, offeringId, assignedToUserId, date }}
        onChange={(next: FilterValues) => { setStatus(next.status); setOfferingId(next.offeringId); setAssignedToUserId(next.assignedToUserId); setDate(next.date); }}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Booking ID or resident"
      />

      {requests.length ? requests.map((request) => (
        <Card key={request.id}>
          <View style={styles.headRow}>
            <Text style={styles.title}>{request.offeringName}</Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {(() => { const u = serviceUrgency(request); return u ? <Pill text={u} color={u === "Overdue" ? theme.danger : theme.amber} /> : null; })()}
              <Pill text={request.statusLabel} color={jobColour(request.status)} />
            </View>
          </View>
          <Text style={styles.meta}>
            {request.kindLabel} · {dateTime(request.scheduledFor)}{request.slotWindow ? ` · ${request.slotWindow}` : ""}
          </Text>
          {request.residentName || request.unitNumber || request.societyName ? (
            <Text style={styles.meta}>{[request.residentName, formatUnit(request.blockName, request.unitNumber), request.societyName].filter(Boolean).join(" · ")}</Text>
          ) : null}
          {request.vehicleType ? <Row label="Vehicle" value={[request.vehicleType, request.vehicleNumber].filter(Boolean).join(" · ")} /> : null}
          {request.address ? <Row label="Where" value={request.address} /> : null}
          {request.assignedToName ? <Row label="Assigned to" value={request.assignedToName} /> : null}
          {request.startedAt ? <Row label="Started" value={dateTime(request.startedAt)} /> : null}
          {request.estimatedHours ? <Row label="Hours booked" value={request.estimatedHours} /> : null}
          <Row
            label={request.includedInPlan ? "Price" : request.finalPaise !== null ? "Charged" : "Quoted"}
            value={request.includedInPlan ? "Included with plan" : rupees(request.payablePaise)}
          />
          {request.cancelledReason ? <Row label="Cancelled" value={request.cancelledReason} /> : null}

          {request.status === "requested" ? (
            <Button label="Take this job" onPress={() => act("Job taken.", () => api.opsAssignService(request.id, undefined, token))} />
          ) : null}
          {request.status === "assigned" ? (
            <Button label="Start" onPress={() => act("Job started.", () => api.opsStartService(request.id, token))} />
          ) : null}
          {request.status === "in_progress" ? (
            <Button label="Complete" onPress={() => setCompleting(request)} />
          ) : null}
          {serviceCancelAllowed(request.status) ? (
            <Button label="Cancel booking" variant="secondary" onPress={() => { setCancelling(request); setCancelReason(""); }} />
          ) : null}
        </Card>
      )) : <Empty text="No bookings here." scene={false} />}

      {completing ? (
        <Card>
          <SectionTitle>Finish {completing.offeringName}</SectionTitle>
          <Text style={styles.meta}>Mark this booking as completed?</Text>
          <Button label="Mark completed" onPress={complete} />
          <Button label="Cancel" variant="secondary" onPress={() => setCompleting(null)} />
        </Card>
      ) : null}

      {cancelling ? (
        <Card>
          <SectionTitle>Cancel {cancelling.offeringName}</SectionTitle>
          <Field label="Reason (optional)" value={cancelReason} onChangeText={setCancelReason} placeholder="Why is this booking being cancelled?" />
          <Button label="Cancel this booking" onPress={cancelBooking} />
          <Button label="Keep it" variant="secondary" onPress={() => setCancelling(null)} />
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

// I-88: urgency, separate from the operational status — Due once the slot window has
// begun, Overdue once it has passed, for a booking not yet worked.
function serviceUrgency(request: ServiceRequestView): "" | "Due" | "Overdue" {
  if (["completed", "cancelled", "in_progress"].includes(request.status)) return "";
  const start = new Date(request.scheduledFor).getTime();
  if (Number.isNaN(start)) return "";
  const now = Date.now();
  if (now >= start + 3 * 3600 * 1000) return "Overdue";
  if (now >= start) return "Due";
  return "";
}

const styles = themed((theme) => ({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  evidenceBlock: { marginTop: 10 },
  evidenceLabel: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal, marginBottom: 6 },
  evidenceRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  evidenceThumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: theme.border },
  qcFailure: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border, paddingTop: 8, marginTop: 8 },
  qcFailureReason: { fontSize: 13, fontFamily: font.bold, color: theme.deepTeal },
  qcFailureRemarks: { fontSize: 13, color: theme.slate, marginTop: 4 },
  qcEvidenceImage: { width: 140, height: 140, borderRadius: 10, marginTop: 8, backgroundColor: theme.border },
  title: { fontSize: 15, fontFamily: font.black, color: theme.deepTeal, flex: 1 },
  meta: { fontSize: 12, color: theme.muted, marginTop: 6 },
  body: { fontSize: 13, color: theme.slate, lineHeight: 19 },
  buttonRow: { flexDirection: "row", marginTop: 8 },
  steps: { marginTop: 10, marginBottom: 6 },
  step: { flexDirection: "row", alignItems: "center", paddingVertical: 3 },
  stepMark: { width: 24, alignItems: "flex-start" },
  stepLabel: { fontSize: 13, color: theme.text.tertiary },
  stepLabelCurrent: { color: theme.text.primary, fontFamily: font.bold },
}));
