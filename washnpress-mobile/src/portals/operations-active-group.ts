// Where a dashboard stage lands on Active Orders.
//
// Web Today's Work tiles (I-105) open the Active tab already filtered to a group.
// Mobile's pipeline uses order-state keys (`picked_up`, `in_wash`…); the Active
// screen uses the same group ids as Web (`pickedUp`, `washing`…). This is the
// translation. Scheduled is not an Active group — Web sends it to Pickups.

export const OPERATOR_ACTIVE_GROUPS = [
  "pickedUp",
  "washing",
  "ironing",
  "qc",
  "qcFailed",
  "readyForDelivery",
  "outForDelivery",
] as const;

export type OperatorActiveGroup = (typeof OPERATOR_ACTIVE_GROUPS)[number];

export type OperatorStageDestination =
  | { tab: "pickups"; group?: undefined }
  | { tab: "active"; group?: OperatorActiveGroup };

const DESTINATIONS: Record<string, OperatorStageDestination> = {
  scheduled: { tab: "pickups" },
  picked_up: { tab: "active", group: "pickedUp" },
  pickedUp: { tab: "active", group: "pickedUp" },
  in_wash: { tab: "active", group: "washing" },
  washing: { tab: "active", group: "washing" },
  ironing: { tab: "active", group: "ironing" },
  qc: { tab: "active", group: "qc" },
  qcPending: { tab: "active", group: "qc" },
  qc_hold: { tab: "active", group: "qcFailed" },
  qcFailed: { tab: "active", group: "qcFailed" },
  ready_for_delivery: { tab: "active", group: "readyForDelivery" },
  readyForDelivery: { tab: "active", group: "readyForDelivery" },
  ready: { tab: "active", group: "readyForDelivery" },
  out_for_delivery: { tab: "active", group: "outForDelivery" },
  outForDelivery: { tab: "active", group: "outForDelivery" },
};

export function operatorStageDestination(source: string | undefined | null): OperatorStageDestination {
  if (!source) return { tab: "active" };
  return DESTINATIONS[source] ?? { tab: "active" };
}

export function resolveActiveGroup(value: string | undefined | null): OperatorActiveGroup | "all" {
  if (value && (OPERATOR_ACTIVE_GROUPS as readonly string[]).includes(value)) {
    return value as OperatorActiveGroup;
  }
  return "all";
}
