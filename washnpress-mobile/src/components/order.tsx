import { View, Text, StyleSheet } from "react-native";
import type { OrderDetail, OrderSummary, Issue } from "../api/types";
import { theme, rupees, dateTime, shortDate, titleCase } from "../theme";
import { Card, Row, StatePill, Pill, SectionTitle, Timeline, Empty, Button } from "./ui";
import { IssueStatusPill, PriorityPill } from "./support";

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

export function OrderList({ orders, onOpen, emptyText = "Nothing here yet.", showSociety = true }: {
  orders: OrderSummary[]; onOpen?: (order: OrderSummary) => void; emptyText?: string; showSociety?: boolean;
}) {
  if (!orders.length) return <Empty text={emptyText} />;
  return <>{orders.map((o) => <OrderCard key={o.id} order={o} showSociety={showSociety} onPress={onOpen ? () => onOpen(o) : undefined} />)}</>;
}

// The shared order detail body. Staff portals show the whole thing; the resident
// view hides the operational fields it has no business seeing.
export function OrderDetailBody({ order, audience, onAnswerDiscrepancy }: {
  order: OrderDetail;
  audience: "resident" | "staff";
  // The resident's answer to a quantity discrepancy. Absent for staff, who see the
  // discrepancy but do not answer it on the resident's behalf.
  onAnswerDiscrepancy?: (answer: "acknowledged" | "disputed") => void;
}) {
  return (
    <>
      <View style={styles.headRow}>
        <Text style={styles.detailCode}>{order.orderCode}</Text>
        <StatePill state={order.state} />
      </View>
      {order.delayed ? <Pill text={`Delayed by ${Math.round(order.delayMinutes / 60)}h`} color={theme.danger} /> : null}

      <SectionTitle>Order</SectionTitle>
      <Card>
        <Row label="Booked" value={dateTime(order.createdAt)} />
        <Row label="Pickup date" value={order.slot ? shortDate(order.slot.date) : "—"} />
        <Row label="Pickup slot" value={order.slot ? `${order.slot.startTime} – ${order.slot.endTime}` : "—"} />
        <Row label="Society" value={order.societyName} />
        {audience === "staff" ? <Row label="Area" value={order.areaName} /> : null}
        <Row label="Pickup address" value={order.pickupAddress} />
        {audience === "staff" ? <Row label="Resident" value={order.residentName} /> : null}
        {audience === "staff" ? <Row label="Phone" value={order.residentPhone} /> : null}
        {audience === "staff" ? <Row label="Flat / unit" value={order.unitNumber} /> : null}
        {audience === "staff" ? <Row label="Assigned operator" value={order.operatorName} /> : null}
        <Row label="Expected completion" value={dateTime(order.expectedCompletionAt)} />
        {order.qrBatchCode ? <Row label="QR batch" value={order.qrBatchCode} /> : null}
      </Card>

      <SectionTitle>Garments</SectionTitle>
      <Card>
        {order.items.length
          ? order.items.map((item) => <Row key={item.category} label={item.category} value={String(item.quantity)} />)
          : <Row label="Recorded quantity" value={order.estimatedCount ? `${order.estimatedCount} (resident estimate)` : "Not collected yet"} />}
        <View style={styles.divider} />
        <Row label="Total garments" value={order.acceptedCount ?? "—"} />
        <Row label="Subscription covered" value={order.subscriptionCoveredCount ?? "—"} />
        <Row label="Additional garments" value={order.additionalCount ?? "—"} />
        <Row label="Rate per additional" value={order.additionalRatePaise ? rupees(order.additionalRatePaise) : "—"} />
        <Row label="Additional charge" value={rupees(order.additionalChargePaise)} />
        <Row label="Payment status" value={titleCase(order.additionalChargeStatus)} />
        {order.deliveryCount !== null ? <Row label="Delivered count" value={order.deliveryCount} /> : null}
        {order.discrepancyReason ? <Row label="Discrepancy" value={order.discrepancyReason} /> : null}
      </Card>

      <SectionTitle>Tracking</SectionTitle>
      <Card><Timeline stages={order.stages} /></Card>

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

      <SectionTitle>History</SectionTitle>
      <Card>
        {order.timeline.map((entry, index) => (
          <View key={`${entry.state}-${index}`} style={styles.timelineEntry}>
            <Text style={styles.timelineState}>{titleCase(entry.state)}</Text>
            <Text style={styles.timelineAt}>{dateTime(entry.at)}{entry.note ? ` · ${entry.note}` : ""}</Text>
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

const styles = StyleSheet.create({
  discrepancyActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  code: { fontSize: 15, fontWeight: "800", color: theme.deepTeal },
  detailCode: { fontSize: 22, fontWeight: "800", color: theme.deepTeal },
  meta: { fontSize: 12, color: theme.muted, marginTop: 3 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 8 },
  timelineEntry: { paddingVertical: 5 },
  timelineState: { fontSize: 13, fontWeight: "700", color: theme.slate },
  timelineAt: { fontSize: 11, color: theme.muted, marginTop: 1 },
  issueType: { fontSize: 14, fontWeight: "700", color: theme.deepTeal, flex: 1 },
  pills: { flexDirection: "row", gap: 6 },
  issueBody: { fontSize: 13, color: theme.slate, marginTop: 6 },
  resolution: { fontSize: 12, color: theme.success, marginTop: 6, fontWeight: "600" },
});
