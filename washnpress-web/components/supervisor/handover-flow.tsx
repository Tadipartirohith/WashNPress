"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle2, PackageSearch, UserCheck, Users2 } from "lucide-react";
import { Modal } from "@/components/portal/modal";
import { FormField } from "@/components/portal/form-field";
import { Panel } from "@/components/portal/panel";
import { useAsync, useAction } from "@/lib/use-async";
import { supervisorApi, type OperatorSummary, type AvailabilityResult } from "@/lib/api/supervisor";
import { cn } from "@/lib/utils";

type TargetStatus = "on_leave" | "blocked" | "active";
type Step = "reason" | "handover" | "confirm" | "done";

const labelFor: Record<TargetStatus, string> = { on_leave: "on leave", blocked: "blocked", active: "back on duty" };

// The flagship supervisor flow: taking an operator off duty never deletes them and
// never strands their work (see washnpress-v2/docs/CONTINUITY.md). Reassignment is
// always a change of who is holding open work, never a rewrite of the work itself —
// completed orders and the operator's own account and history are untouched.
//
// Returning somebody to duty needs no handover step; taking them off it always
// walks through: reason -> what happens to their open work -> a plain-language
// confirmation of exactly that -> submit.
export function HandoverFlowModal({
  operator, target, onClose, onDone,
}: {
  operator: OperatorSummary;
  target: TargetStatus;
  onClose: () => void;
  onDone: (result: AvailabilityResult) => void;
}) {
  const needsHandover = target !== "active";
  const [step, setStep] = useState<Step>(needsHandover ? "reason" : "confirm");
  const [reason, setReason] = useState("");
  const [choice, setChoice] = useState<"reassign" | "release">("release");
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  const [result, setResult] = useState<AvailabilityResult | null>(null);

  const preview = useAsync(() => supervisorApi.handoverPreview(operator.id), [operator.id]);
  const submit = useAction(() => supervisorApi.setAvailability(operator.id, {
    status: target,
    reassignToUserId: needsHandover ? (choice === "reassign" ? reassignTo : null) : undefined,
    reason: reason.trim() || undefined,
  }));

  const colleague = preview.data?.availableOperators.find((o) => o.id === reassignTo) ?? null;

  const confirm = async () => {
    try {
      const r = await submit.run();
      setResult(r);
      setStep("done");
    } catch { /* surfaced via submit.error */ }
  };

  const title = target === "active"
    ? `Return ${operator.fullName ?? "operator"} to duty`
    : `Take ${operator.fullName ?? "this operator"} off duty`;

  return (
    <Modal open onClose={onClose} title={title} variant="center" description={needsHandover ? "Their account and completed work are never touched — only the open work's owner changes." : undefined}>
      {needsHandover && step !== "done" && <StepIndicator step={step} />}

      <AnimatePresence mode="wait">
        {step === "reason" && (
          <motion.div key="reason" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-4 space-y-4">
            <FormField
              as="textarea"
              label="Reason (optional)"
              hint="Shown in the audit trail and to the colleague who picks up their work, if any."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Medical leave for the week"
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring">Cancel</button>
              <button onClick={() => setStep("handover")} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring">
                Continue <ArrowRight className="size-4" />
              </button>
            </div>
          </motion.div>
        )}

        {step === "handover" && (
          <motion.div key="handover" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-4 space-y-4">
            <Panel loading={preview.loading} error={preview.error} onRetry={preview.reload}>
              {preview.data && (
                <>
                  <div className="rounded-xl bg-foreground/5 p-3.5 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground"><PackageSearch className="size-4" /> Currently holding</div>
                    <p className="mt-1 font-display text-xl font-bold tabular-nums">{preview.data.openCount} open order{preview.data.openCount === 1 ? "" : "s"}</p>
                    {preview.data.openCount > 0 && (
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {preview.data.openOrders.slice(0, 4).map((o) => (
                          <li key={o.id}>{o.orderCode} · {o.residentName ?? "Resident"} · {o.state.replace(/_/g, " ")}</li>
                        ))}
                        {preview.data.openOrders.length > 4 && <li>+{preview.data.openOrders.length - 4} more</li>}
                      </ul>
                    )}
                  </div>

                  {preview.data.openCount > 0 ? (
                    <div className="space-y-2.5">
                      <ChoiceCard
                        active={choice === "reassign"}
                        icon={UserCheck}
                        title="Reassign to a colleague"
                        description="Name a specific active operator in this society to take over every open order."
                        onClick={() => setChoice("reassign")}
                      >
                        {choice === "reassign" && (
                          <FormField
                            as="select" label="Reassign to" className="mt-3"
                            value={reassignTo ?? ""}
                            onChange={(e) => setReassignTo(e.target.value || null)}
                          >
                            <option value="" disabled>Choose a colleague…</option>
                            {preview.data.availableOperators.map((o) => (
                              <option key={o.id} value={o.id}>{o.fullName ?? o.id}</option>
                            ))}
                          </FormField>
                        )}
                        {choice === "reassign" && preview.data.availableOperators.length === 0 && (
                          <p className="mt-2 text-xs text-danger">No other active operator is available in this society — release to the queue instead.</p>
                        )}
                      </ChoiceCard>
                      <ChoiceCard
                        active={choice === "release"}
                        icon={Users2}
                        title="Release to the shared queue"
                        description="Every open order goes back unassigned; any active operator in the society can claim one."
                        onClick={() => setChoice("release")}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">They aren&apos;t holding any open work right now, so there is nothing to hand over.</p>
                  )}
                </>
              )}
            </Panel>
            <div className="flex justify-between gap-2">
              <button onClick={() => setStep("reason")} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring">
                <ArrowLeft className="size-4" /> Back
              </button>
              <button
                onClick={() => setStep("confirm")}
                disabled={preview.loading || (choice === "reassign" && !reassignTo && (preview.data?.openCount ?? 0) > 0)}
                className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow hover:brightness-110 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Continue <ArrowRight className="size-4" />
              </button>
            </div>
          </motion.div>
        )}

        {step === "confirm" && (
          <motion.div key="confirm" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} className="mt-4 space-y-4">
            <div className="rounded-2xl bg-primary/10 p-4 text-sm ring-1 ring-primary/20">
              <p>
                <strong>{operator.fullName ?? "This operator"}</strong> will be marked <strong>{labelFor[target]}</strong>.
              </p>
              {needsHandover && (
                <p className="mt-2">
                  {(preview.data?.openCount ?? 0) === 0
                    ? "They have no open orders, so nothing needs to move."
                    : choice === "reassign"
                      ? <>All {preview.data?.openCount} open order(s) move to <strong>{colleague?.fullName ?? "the chosen colleague"}</strong>, exactly as they stand — order state and history are untouched.</>
                      : <>All {preview.data?.openCount} open order(s) return to the shared queue for any active operator in the society to claim.</>}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">Their account and everything they&apos;ve already completed stay exactly as they are. This can be reversed at any time by marking them active again.</p>
            </div>
            {submit.error && <p className="text-sm text-danger">{submit.error}</p>}
            <div className="flex justify-between gap-2">
              {needsHandover && (
                <button onClick={() => setStep("handover")} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring">
                  <ArrowLeft className="size-4" /> Back
                </button>
              )}
              <button
                onClick={confirm}
                disabled={submit.busy}
                className={cn("ml-auto inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold shadow-glow hover:brightness-110 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring",
                  target === "blocked" ? "bg-danger text-white" : "bg-primary text-primary-foreground")}
              >
                {submit.busy ? "Applying…" : `Confirm — mark ${labelFor[target]}`}
              </button>
            </div>
          </motion.div>
        )}

        {step === "done" && result && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="mt-4 space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <p className="font-display text-lg font-bold">{operator.fullName ?? "Operator"} is now {labelFor[target]}.</p>
            <p className="text-sm text-muted-foreground">
              {result.reassigned.length > 0
                ? `${result.reassigned.length} order(s) reassigned.`
                : result.returnedToQueue > 0
                  ? `${result.returnedToQueue} order(s) released to the shared queue.`
                  : "No open work needed to move."}
            </p>
            <button onClick={() => onDone(result)} className="w-full rounded-xl bg-primary py-3 font-semibold text-primary-foreground shadow-glow hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring">
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Modal>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: Step[] = ["reason", "handover", "confirm"];
  const idx = steps.indexOf(step);
  return (
    <div className="mt-1 flex items-center gap-2" aria-hidden="true">
      {steps.map((s, i) => (
        <span key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i <= idx ? "bg-primary" : "bg-foreground/10")} />
      ))}
    </div>
  );
}

// A radio-style card whose body (icon, title, description) picks the option, while
// any extra control passed as `children` (e.g. the "reassign to" dropdown) sits
// outside that clickable region — a <select> nested inside a <button> would be
// invalid HTML and would fire the card's onClick before the dropdown ever opened.
function ChoiceCard({ active, icon: Icon, title, description, onClick, children }: {
  active: boolean; icon: typeof UserCheck; title: string; description: string; onClick: () => void; children?: React.ReactNode;
}) {
  return (
    <div className={cn("w-full rounded-2xl p-4 transition", active ? "bg-primary/15 ring-1 ring-primary" : "glass hover:ring-1 hover:ring-primary/40")}>
      <div
        role="radio"
        aria-checked={active}
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
        className="flex cursor-pointer items-start gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", active ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary")}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-left">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}
