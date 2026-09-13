// Operator Profile — the same read-only rows Web's ProfileTab shows from
// GET /v1/operations/profile. Empty operator-detail fields become "—"; coverage
// uses Web's Unassigned / None assigned / 0 fallbacks.

export const OPERATOR_PROFILE_ENDPOINT = "/v1/operations/profile";

function dash(value: string | number | null | undefined): string | number {
  if (value === null || value === undefined || value === "") return "—";
  return value;
}

export interface OperatorProfileFields {
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  employeeId?: string | null;
  societyName?: string | null;
  supervisorName?: string | null;
  blockNames?: string[] | null;
  flatsCovered?: number | null;
}

export interface OperatorProfileView {
  fullName: string | number;
  phone: string | number;
  email: string | number;
  employeeId: string | number;
  society: string;
  supervisor: string;
  blocks: string;
  flatsCovered: number;
}

export function operatorProfileView(p: OperatorProfileFields | null | undefined): OperatorProfileView {
  return {
    fullName: dash(p?.fullName),
    phone: dash(p?.phone),
    email: dash(p?.email),
    employeeId: dash(p?.employeeId),
    society: p?.societyName ?? "Unassigned",
    supervisor: p?.supervisorName ?? "None assigned",
    blocks: (p?.blockNames ?? []).join(", ") || "None assigned",
    flatsCovered: p?.flatsCovered ?? 0,
  };
}

export function operatorProfileRequest(): { method: "GET"; path: string } {
  return { method: "GET", path: OPERATOR_PROFILE_ENDPOINT };
}
