import { randomUUID } from "node:crypto";
import type { Order, RefundRequest } from "../domain/models";
import type { DataStore } from "../ports/repositories";
import type { WalletService } from "./wallet-service";
import type { NotificationService } from "./notification-service";

// Refunds, as a request that someone approves rather than a wallet credit that
// happens on its own. An operator or supervisor asks for the money on an order to go
// back; a supervisor for that society, or any admin, decides. Only on approval does
// the money actually move, and the record keeps who asked, who decided, and why —
// so a refund can always be accounted for afterwards.

export class RefundError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RefundError";
  }
}

// Who is deciding, reduced to what the decision actually depends on: an admin may
// approve anything, and a supervisor may approve a refund for a society they hold.
export interface RefundApprover {
  userId: string;
  isAdmin: boolean;
  societyIds: string[];
}

export class RefundService {
  constructor(
    private readonly store: DataStore,
    private readonly wallet: WalletService,
    private readonly notifications: NotificationService,
  ) {}

  private canDecide(approver: RefundApprover, request: RefundRequest): boolean {
    return approver.isAdmin || approver.societyIds.includes(request.societyId);
  }

  // What can be refunded on an order: the charge that was actually paid, and the tax
  // taken with it. An order whose charge never settled has nothing to give back.
  private refundableOf(order: Order): { chargePaise: number; taxPaise: number } | null {
    if (order.additionalChargeStatus !== "paid") return null;
    const chargePaise = order.additionalChargePaise ?? 0;
    if (chargePaise <= 0) return null;
    return { chargePaise, taxPaise: order.taxPaise ?? 0 };
  }

  // Ask for a refund on an order. Refuses where there is nothing paid to return, or
  // where a refund is already in flight or done, rather than raising a second one.
  async request(input: { orderId: string; reason: string; requestedByUserId: string }): Promise<RefundRequest> {
    const order = await this.store.orders.get(input.orderId);
    if (!order) throw new RefundError("order_not_found", "That order does not exist.");
    const refundable = this.refundableOf(order);
    if (!refundable) throw new RefundError("nothing_to_refund", "This order has no settled charge to refund.");

    const open = await this.store.refundRequests.find(
      (r) => r.orderId === order.id && r.status !== "rejected",
    );
    if (open.length > 0) {
      throw new RefundError(
        open[0].status === "approved" ? "already_refunded" : "already_requested",
        open[0].status === "approved" ? "This order has already been refunded." : "A refund is already awaiting a decision on this order.",
      );
    }

    const reason = input.reason.trim();
    if (!reason) throw new RefundError("reason_required", "Say why the money is being returned.");

    const request: RefundRequest = {
      id: randomUUID(),
      orderId: order.id,
      orderCode: order.orderCode,
      residentId: order.residentId,
      societyId: order.societyId,
      amountPaise: refundable.chargePaise,
      taxPaise: refundable.taxPaise,
      reason,
      requestedByUserId: input.requestedByUserId,
      status: "pending",
      decidedByUserId: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
    };
    return this.store.refundRequests.put(request);
  }

  // Approve it: put the money back on the wallet — the charge from RefundsPayable,
  // the tax from TaxPayable — and mark the order refunded so the revenue report nets
  // it out. Guarded so a supervisor cannot approve a refund outside their societies.
  async approve(id: string, approver: RefundApprover, note?: string): Promise<RefundRequest> {
    const request = await this.decidable(id, approver);
    await this.wallet.refund(request.residentId, request.amountPaise, request.taxPaise, `refund-${request.orderId}`);

    const order = await this.store.orders.get(request.orderId);
    if (order) {
      order.additionalChargeStatus = "refunded";
      await this.store.orders.put(order);
    }

    request.status = "approved";
    request.decidedByUserId = approver.userId;
    request.decidedAt = new Date().toISOString();
    request.decisionNote = note?.trim() || null;
    const saved = await this.store.refundRequests.put(request);

    await this.notifications.notifyResident(request.residentId, {
      type: "payment.refund_approved",
      orderId: request.orderId,
      title: "Refund approved",
      body: `${((request.amountPaise + request.taxPaise) / 100).toFixed(2)} rupees for order ${request.orderCode} has been returned to your wallet.`,
    });
    return saved;
  }

  // Turn it down. Nothing moves; the reason is kept so the person who asked can see
  // why, and a fresh request can still be raised later if the decision changes.
  async reject(id: string, approver: RefundApprover, note?: string): Promise<RefundRequest> {
    const request = await this.decidable(id, approver);
    request.status = "rejected";
    request.decidedByUserId = approver.userId;
    request.decidedAt = new Date().toISOString();
    request.decisionNote = note?.trim() || null;
    return this.store.refundRequests.put(request);
  }

  private async decidable(id: string, approver: RefundApprover): Promise<RefundRequest> {
    const request = await this.store.refundRequests.get(id);
    if (!request) throw new RefundError("not_found", "That refund request does not exist.");
    if (request.status !== "pending") throw new RefundError("already_decided", "That refund request has already been decided.");
    if (!this.canDecide(approver, request)) throw new RefundError("forbidden", "That refund is for a society you do not manage.");
    return request;
  }

  // The refunds a decider can see: an admin sees all, a supervisor sees their own
  // societies'. Newest first, because a queue is worked from the top.
  async list(approver: RefundApprover, status?: RefundRequest["status"]): Promise<RefundRequest[]> {
    let rows = await this.store.refundRequests.all();
    if (!approver.isAdmin) rows = rows.filter((r) => approver.societyIds.includes(r.societyId));
    if (status) rows = rows.filter((r) => r.status === status);
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
