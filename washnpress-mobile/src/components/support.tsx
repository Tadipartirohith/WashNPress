import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import type { Issue, IssuePriority, IssueStatus, ConversationView, ConversationMessage } from "../api/types";
import { theme, dateTime, shortDate, titleCase } from "../theme";
import { Card, Row, Pill, Button, Field, SectionTitle, Empty, Notice } from "./ui";

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
// The issue as a chat.
//
// It used to be a list of cards, which made a conversation between four people
// impossible to follow. It is a thread now: chronological, a person's own messages on
// one side and everybody else's on the other, and the system in the middle belonging
// to nobody. Which side a message sits on is decided by the backend, because "mine"
// depends on who is looking.
export function Conversation({ conversation, issue }: { conversation?: ConversationView | null; issue?: Issue }) {
  // A conversation the backend has answered is preferred; an issue's raw messages are
  // the fallback for a screen that has not asked for one yet.
  const messages: ConversationMessage[] = conversation?.messages
    ?? (issue?.messages ?? []).map((m) => ({
      author: m.author,
      authorRole: m.authorRole ?? null,
      authorName: m.authorName ?? null,
      body: m.body,
      at: m.at,
      side: m.authorRole === "system" ? "system" : m.authorRole === "resident" ? "theirs" : "mine",
      system: m.authorRole === "system",
      unread: false,
    }));

  if (!messages.length) return <Empty text="No messages yet." />;

  return (
    <View>
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        // A date only where the day changes, the way a chat does it.
        const showDay = !previous || message.at.slice(0, 10) !== previous.at.slice(0, 10);
        return (
          <View key={`${message.at}-${index}`}>
            {showDay ? <Text style={styles.daySeparator}>{shortDate(message.at)}</Text> : null}
            <View style={[
              styles.bubble,
              message.side === "system" ? styles.fromSystem : message.side === "mine" ? styles.fromStaff : styles.fromResident,
              message.unread && message.side !== "mine" ? styles.unreadBubble : null,
            ]}>
              <Text style={styles.bubbleWho}>
                {message.system
                  ? "System"
                  : message.authorName ?? titleCase(message.authorRole ?? "support")}
              </Text>
              <Text style={styles.bubbleBody}>{message.body}</Text>
              <Text style={styles.bubbleAt}>{timeOnly(message.at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// The time a message was sent, which is what a chat shows beside a bubble.
function timeOnly(at: string): string {
  const shown = dateTime(at);
  const parts = shown.split(" ");
  return parts.length > 1 ? parts.slice(-2).join(" ") : shown;
}

// The full ticket, with whatever actions the caller supplies underneath.
export function TicketDetail({ issue, audience, conversation, children }: {
  issue: Issue;
  audience: "resident" | "staff";
  // What the backend says about the conversation for whoever is looking.
  conversation?: ConversationView | null;
  children?: React.ReactNode;
}) {
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

      {/* One conversation section. There used to be two — "Answer the Resident" and
          a separate Actions block with its own permanent Resolution Note field —
          which put communicating about an issue and resolving it in different places
          and hardcoded who was being answered. */}
      <SectionTitle
        action={conversation?.unreadCount ? <Pill text={`${conversation.unreadCount} new`} color={theme.amber} /> : undefined}
      >
        Conversation
      </SectionTitle>
      <Card><Conversation conversation={conversation} issue={issue} /></Card>

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
//
// The label is never written into the screen. "Answer the Resident" was, so a
// supervisor asking their operator for information was told they were answering the
// resident — and an operator who had escalated an issue away could still type into
// it. Both come from the conversation now.
export function ReplyBox({ label, onSend, disabled, conversation }: {
  label?: string;
  onSend: (body: string) => Promise<void>;
  disabled?: boolean;
  conversation?: ConversationView | null;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  // Read-only is said in a sentence rather than shown as a box that does nothing.
  if (conversation && !conversation.canReply) {
    return <Notice tone="warn" text={`🔒 ${conversation.readOnlyReason ?? "This conversation is read-only."}`} />;
  }

  return (
    <>
      <Field
        label={conversation?.replyLabel ?? label ?? "Add a message"}
        value={body}
        onChangeText={setBody}
        placeholder="Type your message"
      />
      <Button
        label="Send reply"
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

// Resolving an issue asks for the note at the moment of resolving, rather than
// keeping a Resolution Note field on screen permanently beside a Resolve button.
export function ResolveBox({ onResolve, onClose, canClose = true }: {
  onResolve: (note: string) => Promise<void>;
  onClose?: () => Promise<void>;
  canClose?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <View style={styles.actionRow}>
        <Button label="Resolve" onPress={() => setAsking(true)} />
        {onClose && canClose ? <Button label="Close issue" variant="secondary" onPress={onClose} /> : null}
      </View>
    );
  }

  return (
    <Card>
      <SectionTitle>Resolve issue</SectionTitle>
      <Field
        label="Resolution note — required"
        value={note}
        onChangeText={setNote}
        placeholder="What was done to resolve this issue?"
      />
      <View style={styles.actionRow}>
        <Button
          label="Confirm resolution"
          disabled={busy || !note.trim()}
          onPress={async () => {
            setBusy(true);
            try { await onResolve(note.trim()); setNote(""); setAsking(false); }
            finally { setBusy(false); }
          }}
        />
        <Button label="Cancel" variant="secondary" onPress={() => { setAsking(false); setNote(""); }} />
      </View>
    </Card>
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
      {/* The last thing said, not the description somebody typed when they opened it
          a week ago — and how much of it this person has not seen. */}
      <Text style={styles.body} numberOfLines={2}>
        {issue.conversation?.preview ?? issue.description}
      </Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>
          {issue.residentName ? `${issue.residentName} · ` : ""}
          {issue.order ? `${issue.order.orderCode} · ` : ""}
          {issue.conversation?.lastMessageAt ? describeAge(issue.ageHours) : describeAge(issue.ageHours)}
          {issue.conversation?.messageCount ? ` · ${issue.conversation.messageCount} message${issue.conversation.messageCount === 1 ? "" : "s"}` : ""}
          {responsibleLabel(issue) ? ` · ${responsibleLabel(issue)}` : ""}
        </Text>
        {issue.conversation?.unreadCount
          ? <Pill text={String(issue.conversation.unreadCount)} color={theme.amber} />
          : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  pills: { flexDirection: "row", gap: 6 },
  title: { fontSize: 18, fontWeight: "800", color: theme.deepTeal, flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "700", color: theme.deepTeal, flex: 1 },
  body: { fontSize: 13, color: theme.slate, marginTop: 6 },
  meta: { fontSize: 11, color: theme.muted, marginTop: 6, flex: 1 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  daySeparator: { fontSize: 11, color: theme.muted, textAlign: "center", marginVertical: 8 },
  unreadBubble: { borderWidth: 1, borderColor: theme.amber },
  resolution: { fontSize: 13, color: theme.success, fontWeight: "600" },
  bubble: { borderRadius: 10, padding: 10, marginBottom: 8, maxWidth: "92%" },
  fromResident: { backgroundColor: theme.bg, alignSelf: "flex-start" },
  fromStaff: { backgroundColor: theme.ice, alignSelf: "flex-end" },
  fromSystem: { backgroundColor: theme.bg, alignSelf: "center", borderWidth: 1, borderColor: theme.border },
  bubbleWho: { fontSize: 11, fontWeight: "800", color: theme.deepTeal },
  bubbleBody: { fontSize: 13, color: theme.slate, marginTop: 3 },
  bubbleAt: { fontSize: 10, color: theme.muted, marginTop: 4 },
});
