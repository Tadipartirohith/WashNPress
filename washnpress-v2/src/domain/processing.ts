import type { CleanStage, GarmentService, OrderLine } from "./models";
import type { OrderState } from "./order-state-machine";
import { TRANSITIONS } from "./order-state-machine";

// Every garment in an order is processed according to the service it was sent for,
// so an order only ever offers the stages its own garments actually need. An Iron
// Only order never shows Start Wash, a Wash Only order never waits for ironing, and
// an order carrying both goes through both. The order lifecycle itself stays the
// same for everyone: Scheduled, Picked Up, processing, QC, Ready, Out, Delivered.

export interface ProcessingRequirement {
  requiresClean: boolean;
  cleanStage: CleanStage;
  requiresPress: boolean;
}

export const CLEAN_STAGE_LABELS: Record<CleanStage, string> = {
  wash: "Washing",
  dry_clean: "Dry Cleaning",
  premium: "Premium Care",
};

export const CLEAN_STAGE_ACTIONS: Record<CleanStage, { start: string; complete: string }> = {
  wash: { start: "Start Wash", complete: "Complete Wash" },
  dry_clean: { start: "Start Dry Clean", complete: "Complete Dry Clean" },
  premium: { start: "Start Premium Care", complete: "Complete Premium Care" },
};

// When an order mixes services, the cleaning stage is named after the most
// specialised one present, because that is the one that dictates how the batch is
// physically handled.
const CLEAN_PRECEDENCE: CleanStage[] = ["premium", "dry_clean", "wash"];

export function serviceRequirement(service: GarmentService): ProcessingRequirement {
  return {
    requiresClean: service.requiresClean,
    cleanStage: service.cleanStage,
    requiresPress: service.requiresPress,
  };
}

// What the order as a whole has to go through: the union of what its lines need.
export function orderRequirement(lines: Pick<OrderLine, "requiresClean" | "cleanStage" | "requiresPress">[]): ProcessingRequirement {
  // An order with no recorded lines predates per line services, or was created
  // before the resident chose any. It keeps the original full wash and iron path.
  if (lines.length === 0) return { requiresClean: true, cleanStage: "wash", requiresPress: true };
  const cleaning = lines.filter((line) => line.requiresClean);
  const cleanStage =
    CLEAN_PRECEDENCE.find((stage) => cleaning.some((line) => line.cleanStage === stage)) ?? "wash";
  return {
    requiresClean: cleaning.length > 0,
    cleanStage,
    requiresPress: lines.some((line) => line.requiresPress),
  };
}

// The stage an order in this state should move to next, given what it needs. The
// state machine says what is structurally legal; this says what is legal for the
// garments actually in the batch.
export function allowedNext(from: OrderState, requirement: ProcessingRequirement): OrderState[] {
  const structural = TRANSITIONS[from] ?? [];
  return structural.filter((to) => {
    if (to === "in_wash") return requirement.requiresClean;
    if (to === "ironing") {
      if (!requirement.requiresPress) return false;
      // Cleaning comes before pressing, so an order that still has to be cleaned
      // cannot jump straight to ironing.
      if (from === "picked_up") return !requirement.requiresClean;
      return true;
    }
    if (to === "qc") {
      // QC is only reachable once every stage the garments need has been done.
      if (from === "picked_up") return !requirement.requiresClean && !requirement.requiresPress;
      if (from === "in_wash") return !requirement.requiresPress;
    }
    return true;
  });
}

export function isAllowedNext(from: OrderState, to: OrderState, requirement: ProcessingRequirement): boolean {
  return allowedNext(from, requirement).includes(to);
}

// The customer facing timeline for this particular order, with the stages its
// garments do not need left out entirely rather than shown as skipped.
export function lifecycleFor(requirement: ProcessingRequirement): OrderState[] {
  const stages: OrderState[] = ["scheduled", "picked_up"];
  if (requirement.requiresClean) stages.push("in_wash");
  if (requirement.requiresPress) stages.push("ironing");
  stages.push("qc", "ready_for_delivery", "out_for_delivery", "delivered");
  return stages;
}

export function stageLabel(state: OrderState, requirement: ProcessingRequirement): string | null {
  if (state === "in_wash") return CLEAN_STAGE_LABELS[requirement.cleanStage];
  return null;
}

// What one line still has to go through, for the operator's per garment checklist.
export function lineStages(line: Pick<OrderLine, "requiresClean" | "cleanStage" | "requiresPress">): Array<{ key: string; label: string }> {
  const stages: Array<{ key: string; label: string }> = [];
  if (line.requiresClean) stages.push({ key: line.cleanStage, label: CLEAN_STAGE_LABELS[line.cleanStage] });
  if (line.requiresPress) stages.push({ key: "iron", label: "Ironing" });
  if (stages.length === 0) stages.push({ key: "none", label: "No processing" });
  return stages;
}
