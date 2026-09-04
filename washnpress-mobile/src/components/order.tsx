import { View, Text, StyleSheet } from "react-native";
import { themed } from "./themed";
import type { OrderDetail, OrderSummary, Issue } from "../api/types";
import { font, theme, space, type, mono, radius, border, rupees, dateTime, shortDate, titleCase, stateLabel } from "../theme";
import { Card, CardGrid, Row, StatePill, Pill, SectionTitle, Timeline, Empty, Button, Notice } from "./ui";
import { IssueStatusPill, PriorityPill } from "./support";
import { RefundRequestControl } from "./refunds";

// What an order comes to: what the services cost, plus anything charged beyond the
// plan. One number, worked out in one place, so a table column and a card cannot
// disagree about the same order.
export function orderTotal(order: OrderSummary): number {
  return (order.servicesPaise ?? 0) + (order.additionalChargePaise ?? 0);
}

// Payment is not order progress, so it is its own badge rather than being appended
// to the status. "Delivered · Charge Pending" read as one confused state.
export function PaymentPill({ order }: { order: OrderSummary }) {
  if (order.additionalChargeStatus === "paid") return <Pill text="Paid" color={theme.success} />;
  if (order.additionalChargeStatus === "pending") return <Pill text="Pending" color={theme.amber} />;
  if (order.additionalChargeStatus === "failed") return <Pill text="Failed" color={theme.danger} />;
  // Nothing beyond the plan was charged, which is not the same as unpaid.
  return <Pill text="Nothing due" color={theme.muted} />;
}

// One order row, used by every list in every portal. The same facts in the same
// order wherever an order appears.
export function OrderCard({ order, onPress, showSociety = true, onPay }: {
  order: OrderSummary;
  onPress?: () => void;
  showSociety?: boolean;
  // Settling what is owed, offered on the row itself. A delivered order with money
  // outstanding belongs in Previous Orders — its lifecycle is finished — and the
  // resident should be able to pay it without opening it first.
  onPay?: () => void;
}) {
  return (
    <Card onPress={onPress}>
      <View style={styles.headRow}>
        <Text style={styles.code}>{order.orderCode}</Text>
        <StatePill state={order.state} />
      </View>
      {order.residentName ? (
        <Text style={styles.meta}>
          {order.residentName}{order.unitNumber ? ` · ${order.unitNumber}` : ""}
          {showSociety && order.societyName ? ` · ${order.societyName}` : ""}
        </Text>
      ) : showSociety && order.societyName ? <Text style={styles.meta}>{order.societyName}</Text> : null}
      <Text style={styles.meta}>
        {order.acceptedCount !== null ? `${order.acceptedCount} garments` : "Quantity pending"}
        {order.additionalCount ? ` · ${order.additionalCount} additional` : ""}
        {order.additionalChargePaise ? ` · ${rupees(order.additionalChargePaise)}` : ""}
      </Text>
      <View style={styles.badgeRow}>
        {order.delayed ? <Pill text={`Delayed ${Math.round(order.delayMinutes / 60)}h`} color={theme.danger} /> : null}
        {order.qcPassed === false ? <Pill text="QC failed" color={theme.danger} /> : null}
        {/* Payment is not order progress. A delivered order with money outstanding
            used to read as "Delivered · Charge Pending", which looked like one
            confused status rather than two clear ones. */}
        {order.additionalChargeStatus === "pending"
          ? <Pill text={`Payment pending${order.additionalChargePaise ? ` · ${rupees(order.additionalChargePaise)}` : ""}`} color={theme.amber} />
          : null}
        {order.additionalChargeStatus === "failed" ? <Pill text="Payment failed" color={theme.danger} /> : null}
        {order.additionalChargeStatus === "paid" ? <Pill text="Paid" color={theme.success} /> : null}
        {order.operatorName ? <Pill text={order.operatorName} color={theme.muted} /> : null}
      </View>
      {onPay && (order.additionalChargeStatus === "pending" || order.additionalChargeStatus === "failed") ? (
        <Button
          label={`Pay now${order.additionalChargePaise ? ` · ${rupees(order.additionalChargePaise)}` : ""}`}
          onPress={onPay}
        />
      ) : null}
    </Card>
  );
}

// Two orders across on anything wider than a phone, one below that.
//
// An order card holds a code, a name, a count and a few badges. At the width of a
// desktop screen that left more than half of every card empty, and a list of a
// hundred orders was a hundred screens of mostly nothing. There is no Open button:
// the card opens the order, which is the only thing anybody wants from it.
export function OrderList({ orders, onOpen, emptyText = "Nothing here yet.", showSociety = true, columns }: {
  orders: OrderSummary[]; onOpen?: (order: OrderSummary) => void; emptyText?: string; showSociety?: boolean;
  // A narrow column — an order list inside a detail panel — says so.
  columns?: { desktop: number; tablet: number; mobile: number };
}) {
  if (!orders.length) return <Empty text={emptyText} />;
  return (
    <CardGrid columns={columns ?? { desktop: 2, tablet: 2, mobile: 1 }}>
      {orders.map((o) => (
        <OrderCard key={o.id} order={o} showSociety={showSociety} onPress={onOpen ? () => onOpen(o) : undefined} />
      ))}
    </CardGrid>
  );
}

// The shared order detail body. Staff portals show the whole thing; the resident
// view hides the operational fields it has no business seeing.
export function OrderDetailBody({ order, audience, onAnswerDiscrepancy, refundToken }: {
  order: OrderDetail;
  audience: "resident" | "staff";
  // The resident's answer to a quantity discrepancy. Absent for staff, who see the
  // discrepancy but do not answer it on the resident's behalf.
  onAnswerDiscrepancy?: (answer: "acknowledged" | "disputed") => void;
  // A staff token that lets the charges card raise a refund on a settled charge.
  // Absent for a resident, and for any read-only staff view that should not.
  refundToken?: string;
}) {
  return (
    <>
      {/* Where it is and when it comes back, before anything else.
          This page used to open on the order code and then eleven reference rows —
          booked at, society, address, phone — with "Expected completion" eleventh
          and the tracking timeline in fifth position, below the charges. Somebody
          opening an order is asking where their laundry is; a resident is not
          opening it to check their own address. */}
      {/* The code alone: the state is the heading of the card below it, and
          printing it twice within an inch of itself says nothing the second time. */}
      <Text style={styles.detailCode}>{order.orderCode}</Text>
      <Card elevated>
        <Text style={styles.leadState}>{stateLabel[order.state] ?? titleCase(order.state)}</Text>
        <Text style={styles.leadWhen}>
          {order.state === "delivered"
            ? `Delivered ${dateTime(order.deliveredAt ?? order.expectedCompletionAt)}`
            : order.expectedCompletionAt
              ? `Expected back ${dateTime(order.expectedCompletionAt)}`
              : "A return time is set once the garments are collected."}
        </Text>
        {order.delayed ? (
          <Notice tone="warn" text={`Running ${Math.round(order.delayMinutes / 60)} hour${Math.round(order.delayMinutes / 60) === 1 ? "" : "s"} late.`} />
        ) : null}
        {/* Whose and where, for staff — the second question they have and one a
            resident never asks about themselves. */}
        {audience === "staff" ? (
          <>
            <Row label="Resident" value={[order.residentName, order.unitNumber].filter(Boolean).join(" · ")} />
            <Row label="Tower" value={order.blockName ?? "—"} />
            <Row label="Operator" value={order.operatorName ?? "Not assigned"} />
          </>
        ) : (
          <Row
            label="Collection"
            value={order.slot ? `${shortDate(order.slot.date)} · ${order.slot.startTime} – ${order.slot.endTime}` : "—"}
          />
        )}
      </Card>

      {/* The journey, immediately under where it has got to. */}
      <SectionTitle>Tracking</SectionTitle>
      <Card><Timeline stages={order.stages} /></Card>

      {/* What was asked for beside what turned up. Both are kept, because one is
          what the resident expected and the other is what the operator verified.
          A field for something that has not happened yet says so rather than
          showing a dash. */}
      <SectionTitle>Garments</SectionTitle>
      <Card>
        {order.items.length
          ? order.items.map((item) => <Row key={item.category} label={item.category} value={String(item.quantity)} />)
          : null}
        {order.items.length ? <View style={styles.divider} /> : null}
        <Row
          label="Resident estimate"
          value={order.quantityHistory?.residentEstimate ?? order.estimatedCount ?? "Not given"}
        />
        <Row
          label="Operator received"
          value={order.quantityHistory?.operatorReceived ?? order.acceptedCount ?? "Not collected yet"}
        />
        {order.quantityHistory?.difference ? (
          <Row
            label="Difference"
            value={order.quantityHistory.difference > 0
              ? `${order.quantityHistory.difference} more than expected`
              : `${Math.abs(order.quantityHistory.difference)} fewer than expected`}
          />
        ) : null}
        {order.quantityHistory?.recordedAt ? (
          <Row
            label="Counted"
            value={`${dateTime(order.quantityHistory.recordedAt)}${order.quantityHistory.recordedByName ? ` by ${order.quantityHistory.recordedByName}` : ""}`}
          />
        ) : null}
        <Row label="Delivered count" value={order.deliveryCount ?? "Not delivered yet"} />
        {order.discrepancyReason ? <Row label="Discrepancy" value={order.discrepancyReason} /> : null}
      </Card>

      {/* The charge, itemised. A total on its own cannot be checked against
          anything. */}
      <SectionTitle>Charges</SectionTitle>
      <Card>
        <Row
          label="Covered by the plan"
          value={order.charges?.subscriptionCoveredCount ?? order.subscriptionCoveredCount ?? (order.acceptedCount === null ? "Not collected yet" : 0)}
        />
        <Row
          label="Additional garments"
          value={order.charges?.additionalCount ?? order.additionalCount ?? (order.acceptedCount === null ? "Not collected yet" : 0)}
        />
        <Row
          label="Rate per additional"
          value={order.additionalRatePaise ? rupees(order.additionalRatePaise) : "Not applicable"}
        />
        {(order.charges?.servicesPaise ?? order.servicesPaise) > 0
          ? <Row label="Services" value={rupees(order.charges?.servicesPaise ?? order.servicesPaise)} /> : null}
        {/* GST, where it was charged. Shown as the two halves an invoice carries, so
            the total below is explained rather than just stated. */}
        {(order.charges?.taxPaise ?? 0) > 0 ? (
          <>
            <Row label="CGST" value={rupees(order.charges?.cgstPaise ?? 0)} />
            <Row label="SGST" value={rupees(order.charges?.sgstPaise ?? 0)} />
          </>
        ) : null}
        <View style={styles.divider} />
        <Row label="Total" value={rupees(order.charges?.totalPaise ?? order.additionalChargePaise ?? 0)} />
        <Row
          label="Payment status"
          value={order.additionalChargeStatus === "none" ? "Nothing to pay" : titleCase(order.additionalChargeStatus)}
        />
        {order.charges?.payPerOrder ? <Row label="Priced" value="Per garment, without a plan" /> : null}
        {/* Staff can raise a refund on a settled charge, from the order it belongs to.
            The money moves only once a supervisor or admin approves it. */}
        {audience === "staff" && refundToken ? (
          <RefundRequestControl token={refundToken} orderId={order.id} status={order.additionalChargeStatus} />
        ) : null}
      </Card>

      {/* Every attempt, in order. A failed charge posts nothing to the ledger, so
          without this the only record was a status the next attempt overwrote. */}
      {order.paymentHistory?.length ? (
        <>
          <SectionTitle>Payment history</SectionTitle>
          <Card>
            {order.paymentHistory.map((event, index) => (
              <View key={`${event.at}-${index}`} style={styles.historyEntry}>
                <View style={styles.headRow}>
                  <Text style={styles.historyTitle}>
                    {rupees(event.amountPaise)}{event.kind === "retry" ? " (retried)" : ""}
                  </Text>
                  <Pill
                    text={titleCase(event.status)}
                    color={event.status === "paid" ? theme.success : event.status === "failed" ? theme.danger : theme.amber}
                  />
                </View>
                <Text style={styles.meta}>
                  {dateTime(event.at)}{event.note ? `. ${event.note}` : ""}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {/* The reference: booked when, going where, collected from what address.
          Real questions, but not the first ones, and not questions at all most of
          the times this page is opened. */}
      <SectionTitle>Order details</SectionTitle>
      <Card>
        <Row label="Booked" value={dateTime(order.createdAt)} />
        <Row label="Collection" value={order.slot ? `${shortDate(order.slot.date)} · ${order.slot.startTime} – ${order.slot.endTime}` : "—"} />
        <Row label="Society" value={order.societyName} />
        <Row label="Pickup address" value={order.pickupAddress} />
        {audience === "staff" ? <Row label="Phone" value={order.residentPhone} figure /> : null}
        {order.qrBatchCode ? <Row label="QR batch" value={order.qrBatchCode} figure /> : null}
      </Card>

      {/* What the resident declared, beside what the operator counted. Both are kept,
          because one is what was expected and the other is what was verified — and
          the resident gets to say whether they accept it. */}
      {order.quantityDiscrepancy ? (
        <>
          <SectionTitle>Quantity discrepancy</SectionTitle>
          <Card>
            <Row label="You requested" value={order.quantityDiscrepancy.requested} />
            <Row label="Collected" value={order.quantityDiscrepancy.received} />
            <Row
              label="Difference"
              value={order.quantityDiscrepancy.direction === "short"
                ? `${order.quantityDiscrepancy.difference} short`
                : `${order.quantityDiscrepancy.difference} extra`}
            />
            <Row label="Reason" value={order.quantityDiscrepancy.reasonLabel} />
            <Row label="Remarks" value={order.quantityDiscrepancy.remarks} />
            <Row
              label="Your answer"
              value={order.quantityDiscrepancy.acknowledgement === "pending"
                ? "Waiting for you"
                : titleCase(order.quantityDiscrepancy.acknowledgement)}
            />
            {order.quantityDiscrepancy.disputeNote
              ? <Row label="What you said" value={order.quantityDiscrepancy.disputeNote} />
              : null}
          </Card>
          {onAnswerDiscrepancy && order.quantityDiscrepancy.acknowledgement === "pending" ? (
            <View style={styles.discrepancyActions}>
              <Button label="Acknowledge" onPress={() => onAnswerDiscrepancy("acknowledged")} />
              <Button label="Dispute this" variant="danger" onPress={() => onAnswerDiscrepancy("disputed")} />
            </View>
          ) : null}
        </>
      ) : null}

      {/* Who has held the order. The current holder is a single field, which
          cannot answer "who had this yesterday" - the question asked whenever
          something went wrong on a day nobody remembers. */}
      {audience === "staff" && order.assignmentHistory?.length ? (
        <>
          <SectionTitle>Assignment history</SectionTitle>
          <Card>
            {order.assignmentHistory.map((entry, index) => (
              <View key={`${entry.at}-${index}`} style={styles.historyEntry}>
                <Text style={styles.historyTitle}>
                  {entry.toName ?? "Unassigned"}
                  {entry.fromName ? ` (from ${entry.fromName})` : ""}
                </Text>
                <Text style={styles.meta}>
                  {dateTime(entry.at)}
                  {entry.byName ? `. Moved by ${entry.byName}` : ""}
                  {entry.note ? `. ${entry.note}` : ""}
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Status history</SectionTitle>
      <Card>
        {(order.statusHistory ?? order.timeline).map((entry, index) => (
          <View key={`${entry.state}-${index}`} style={styles.timelineEntry}>
            <Text style={styles.timelineState}>
              {(entry as { label?: string }).label || titleCase(entry.state)}
            </Text>
            <Text style={styles.timelineAt}>
              {dateTime(entry.at)}
              {"actorName" in entry && entry.actorName ? `. ${entry.actorName}` : ""}
              {entry.note ? `. ${entry.note}` : ""}
            </Text>
          </View>
        ))}
      </Card>

      {order.issues.length ? (
        <>
          <SectionTitle>Issues</SectionTitle>
          {order.issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
        </>
      ) : null}
    </>
  );
}

export function IssueCard({ issue, onPress, children }: { issue: Issue; onPress?: () => void; children?: React.ReactNode }) {
  return (
    <Card onPress={onPress}>
      <View style={styles.headRow}>
        <Text style={styles.issueType}>{titleCase(issue.category)}</Text>
        <View style={styles.pills}>
          <PriorityPill priority={issue.priority} />
          <IssueStatusPill status={issue.status} />
        </View>
      </View>
      <Text style={styles.issueBody}>{issue.description}</Text>
      <Text style={styles.meta}>
        {dateTime(issue.createdAt)}
        {issue.reportedByRole ? ` · reported by ${issue.reportedByRole}` : ""}
        {issue.escalatedToAdmin ? " · escalated" : ""}
        {issue.messages?.length ? ` · ${issue.messages.length} message${issue.messages.length === 1 ? "" : "s"}` : ""}
      </Text>
      {issue.resolution ? <Text style={styles.resolution}>Resolution: {issue.resolution}</Text> : null}
      {children}
    </Card>
  );
}

const styles = themed((theme) => ({
  // The answer to "where is my laundry", at the size of an answer.
  leadState: { ...type.title, color: theme.text.primary },
  leadWhen: { ...type.body, color: theme.text.secondary, marginTop: space.tight, marginBottom: space.base },

  discrepancyActions: { flexDirection: "row", flexWrap: "wrap", gap: space.snug, marginTop: space.base },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code: { ...type.subheading, ...mono, color: theme.text.primary },
  detailCode: { ...type.title, ...mono, color: theme.text.primary },
  meta: { ...type.caption, color: theme.text.tertiary, marginTop: space.tight },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: space.snug, marginTop: space.snug },
  divider: { height: border.hairline, backgroundColor: theme.line.subtle, marginVertical: space.base },
  timelineEntry: { paddingVertical: space.tight },
  historyEntry: {
    paddingVertical: space.snug,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.line.subtle,
  },
  historyTitle: { ...type.label, color: theme.text.primary },
  timelineState: { ...type.label, color: theme.text.primary },
  timelineAt: { ...type.caption, color: theme.text.tertiary, marginTop: 1 },
  issueType: { ...type.subheading, color: theme.text.primary, flex: 1 },
  pills: { flexDirection: "row", gap: space.snug },
  issueBody: { ...type.label, color: theme.text.secondary, marginTop: space.snug, fontFamily: font.medium },
  resolution: { ...type.caption, color: theme.feedback.successText, marginTop: space.snug, fontFamily: font.semi },
}));
