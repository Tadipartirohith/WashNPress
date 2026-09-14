// Operator Issues — the same Raise-issue body Web's CreateIssueModal sends to
// operationsApi.createIssue. POST /v1/operations/issues; Order ID is optional.

export const CREATE_ISSUE_ENDPOINT = "/v1/operations/issues";

export type IssuePriority = "low" | "normal" | "high";

export const ISSUE_PRIORITIES: { key: IssuePriority; label: string }[] = [
  { key: "low", label: "Low" },
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
];

export function issueTypeLabel(type: string): string {
  return type.replace(/_/g, " ");
}

export function canRaiseIssue(input: { type?: string | null; description?: string | null }): boolean {
  return Boolean(input.type && input.description?.trim());
}

export interface CreateIssueInput {
  type: string;
  description: string;
  priority?: string | null;
  orderId?: string | null;
}

// The same object Web's Raise issue button builds.
export function createIssuePayload(input: CreateIssueInput): {
  type: string;
  description: string;
  orderId?: string;
  priority: IssuePriority;
} {
  const priority: IssuePriority = input.priority === "low" || input.priority === "high" || input.priority === "normal"
    ? input.priority
    : "normal";
  return {
    type: input.type,
    description: input.description.trim(),
    orderId: input.orderId?.trim() || undefined,
    priority,
  };
}

export function createIssueRequest(input: CreateIssueInput): {
  method: "POST";
  path: string;
  body: ReturnType<typeof createIssuePayload>;
} {
  return { method: "POST", path: CREATE_ISSUE_ENDPOINT, body: createIssuePayload(input) };
}
