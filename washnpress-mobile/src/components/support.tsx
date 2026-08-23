import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Issue, IssuePriority, IssueStatus } from "../api/types";
import { theme, dateTime, titleCase } from "../theme";
import { Card, Row, Pill, Button, Field, SectionTitle, Empty } from "./ui";

// Shared support pieces, so a ticket reads the same in the resident, supervisor and
// admin portals and only the available actions differ.

export const ISSUE_STATUS_COLOR: Record<IssueStatus, string> = {
  open: theme.danger,
  in_progress: theme.amber,
  waiting_resident: theme.aqua,
  waiting_operator: theme.aqua,
  escalated_supervisor: theme.amber,
  escalated_admin: theme.danger,
  resolved: theme.success,
  closed: theme.muted,
};

// Written out rather than title-cased, because "Waiting Resident" does not say who
// is waiting for whom and "Escalated Supervisor" reads like a job title.
export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  waiting_resident: "Waiting for Resident",
  waiting_operator: "Waiting for Operator",
  escalated_supervisor: "Escalated to Supervisor",
  escalated_admin: "Escalated to Admin",
  resolved: "Resolved",
  closed: "Closed",
};

// Who has to do something next, said plainly.
export function responsibleLabel(issue: Issue): string | null {
  if (issue.status === "resolved" || issue.status === "closed") return null;
  switch (issue.responsibleRole) {
    case "operator": return "With the operator";
    case "supervisor": return "With the supervisor";
    case "admin": return "With the admin";
    case "resident": return "With the resident";
    default: return null;
  }
}

export const PRIORITY_COLOR: Record<IssuePriority, string> = {
  low: theme.muted,
  normal: theme.aqua,
  high: theme.amber,
  emergency: theme.danger,
};

export function IssueStatusPill({ status }: { status: IssueStatus }) {
  return <Pill text={ISSUE_STATUS_LABEL[status] ?? titleCase(status)} color={ISSUE_STATUS_COLOR[status] ?? theme.muted} />;
}

export function PriorityPill({ priority }: { priority: IssuePriority }) {
  if (priority === "normal" || priority === "low") return null;
  return <Pill text={priority === "emergency" ? "EMERGENCY" : "HIGH"} color={PRIORITY_COLOR[priority]} />;
}

export function describeAge(hours: number | undefined): string {
  if (hours === undefined || hours === null) return "";
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h old`;
  return `${Math.round(hours / 24)}d old`;
}

export function describeMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (60 * 24))} d`;
}

// The conversation between the resident and support, oldest first.
export function Conversation({ issue }: { issue: Issue }) {
  if (!issue.messages?.length) return <Empty text="No messages yet." />;
  return (
    <View>
      {issue.messages.map((message, index) => {
        const fromResident = message.authorRole === "resident";
        const isSystem = message.authorRole === "system";
        return (
          <View key={`${message.at}-${index}`} style={[styles.bubble, isSystem ? styles.fromSystem : fromResident ? styles.fromResident : styles.fromStaff]}>
            <Text style={styles.bubbleWho}>
              {isSystem ? "System" : message.authorName ?? (fromResident ? "Resident" : titleCase(message.authorRole ?? "support"))}
            </Text>
            <Text style={styles.bubbleBody}>{message.body}</Text>
            <Text style={styles.bubbleAt}>{dateTime(message.at)}</Text>
          </View>
        );
      })}
    </View>
  );
}

// The full ticket, with whatever actions the caller supplies underneath.
export function TicketDetail({ issue, audience, children }: { issue: Issue; audience: "resident" | "staff"; children?: React.ReactNode }) {
  return (
    <>
      <View style={styles.headRow}>
        <Text style={styles.title}>{titleCase(issue.category)}</Text>
        <View style={styles.pills}>
          <PriorityPill priority={issue.priority} />
          <IssueStatusPill status={issue.status} />
        </View>
      </View>

      <Card>
        <Row label="Ticket" value={issue.id.slice(0, 8)} />
        <Row label="Raised" value={dateTime(issue.createdAt)} />
        {audience === "staff" ? <Row label="Resident" value={issue.residentName} /> : null}
        {audience === "staff" ? <Row label="Phone" value={issue.residentPhone} /> : null}
        {audience === "staff" ? <Row label="Flat / unit" value={issue.unitNumber} /> : null}
        {audience === "staff" ? <Row label="Society" value={issue.societyName} /> : null}
        {issue.order ? <Row label="Order" value={`${issue.order.orderCode} · ${titleCase(issue.order.state)}`} /> : null}
        {issue.order && audience === "staff" ? <Row label="Operator" value={issue.order.operatorName} /> : null}
        {audience === "staff" ? <Row label="Assigned to" value={issue.assignedToName} /> : null}
        <Row label="Age" value={describeAge(issue.ageHours)} />
        {issue.resolutionMinutes !== null && issue.resolutionMinutes !== undefined
          ? <Row label="Time to resolve" value={describeMinutes(issue.resolutionMinutes)} /> : null}
        {responsibleLabel(issue) ? <Row label="Waiting on" value={responsibleLabel(issue)} /> : null}
        {issue.escalatedToAdmin
          ? <Row label="Escalated" value="Yes, to the admin" />
          : issue.escalatedToSupervisor ? <Row label="Escalated" value="Yes, to the supervisor" /> : null}
      </Card>

      <SectionTitle>What was reported</SectionTitle>
      <Card><Text style={styles.body}>{issue.description}</Text></Card>

      <SectionTitle>Conversation</SectionTitle>
      <Card><Conversation issue={issue} /></Card>

      {issue.resolution ? (
        <>
          <SectionTitle>Resolution</SectionTitle>
          <Card><Text style={styles.resolution}>{issue.resolution}</Text></Card>
        </>
      ) : null}

      {children}
    </>
  );
}

// A compose box that clears itself once the message is sent.
export function ReplyBox({ label, onSend, disabled }: { label: string; onSend: (body: string) => Promise<void>; disabled?: boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Field label={label} value={body} onChangeText={setBody} placeholder="Type your message" />
      <Button
        label="Send"
        disabled={busy || disabled || !body.trim()}
        onPress={async () => {
          setBusy(true);
          try { await onSend(body.trim()); setBody(""); }
          finally { setBusy(false); }
        }}
      />
    </>
  );
}

export function IssueRow({ issue, onPress }: { issue: Issue; onPress?: () => void }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.headRow}>
        <Text style={styles.rowTitle}>{titleCase(issue.category)}</Text>
        <View style={styles.pills}>
          <PriorityPill priority={issue.priority} />
          <IssueStatusPill status={issue.status} />
        </View>
      </View>
      <Text style={styles.body} numberOfLines={2}>{issue.description}</Text>
      <Text style={styles.meta}>
        {issue.residentName ? `${issue.residentName} · ` : ""}
        {issue.order ? `${issue.order.orderCode} · ` : ""}
        {describeAge(issue.ageHours)}
        {issue.messages?.length ? ` · ${issue.messages.length} message${issue.messages.length === 1 ? "" : "s"}` : ""}
        {responsibleLabel(issue) ? ` · ${responsibleLabel(issue)}` : ""}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  pills: { flexDirection: "row", gap: 6 },
  title: { fontSize: 18, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.deepTeal, flex: 1 },
  body: { fontSize: 13, color: theme.slate, marginTop: 6 },
  meta: { fontSize: 11, color: theme.muted, marginTop: 6 },
  resolution: { fontSize: 13, color: theme.success, fontWeight: "600" },
  bubble: { borderRadius: 10, padding: 10, marginBottom: 8, maxWidth: "92%" },
  fromResident: { backgroundColor: theme.bg, alignSelf: "flex-start" },
  fromStaff: { backgroundColor: theme.ice, alignSelf: "flex-end" },
  fromSystem: { backgroundColor: theme.bg, alignSelf: "center", borderWidth: 1, borderColor: theme.border },
  bubbleWho: { fontSize: 11, fontWeight: "800", color: theme.deepTeal },
  bubbleBody: { fontSize: 13, color: theme.slate, marginTop: 3 },
  bubbleAt: { fontSize: 10, color: theme.muted, marginTop: 4 },
});
