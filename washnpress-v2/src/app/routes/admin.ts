import type { FastifyInstance } from "fastify";
import { InvalidPlanError } from "../../domain/plan-usage";
import {
  InvalidOfferingError, SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, CUSTOMER_ELIGIBILITIES,
} from "../../domain/service-catalogue";
import { MEASUREMENT_UNITS } from "../../domain/measurement";
import { STATES } from "../../domain/regions";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole, withScope } from "../guards";
import { UserConflictError } from "../../services/user-service";
import { SocietyConflictError, SocietyInvalidError } from "../../services/society-service";
import { staffDetailProblems } from "../../domain/staff-identity";
import { ISSUE_TYPES, ISSUE_PRIORITIES, IssueTransitionError, ConversationClosedError } from "../../services/issue-service";
import { StaffingError } from "../../services/staffing-service";
import { SHIFTS, DuplicateSlotError, SlotInPastError, SlotInUseError, SlotTooSoonError, UnknownSlotWindowError, SLOT_WINDOWS } from "../../services/scheduling-service";
import type { SystemConfig, SupportTicket } from "../../domain/models";
import { DEFAULT_GARMENT_CATEGORIES, DEFAULT_GARMENT_SERVICES, DuplicateServiceError, InvalidServiceError, normaliseService } from "../../services/system-config-service";
import { STATE_LABELS } from "../../domain/order-state-machine";
import { paginate } from "../paging";
import { serviceDay, today, withinServiceDays } from "../../services/scheduling-service";
import { NotYourStaffError } from "../../services/user-service";
import { AssignmentError } from "../../domain/assignment";

// A name in two parts, a number, one society, and optionally an email.
//
// No employee id: it is generated. No verification codes: creating an account and
// authenticating as that account are two different things, and running them
// together meant an admin filling in a form had to hold an OTP sent to somebody
// else's phone before the account could exist. The number is proved by the person
// who owns it, with the OTP they receive at their first sign-in.
const supervisorSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(10).max(10),
  // Somewhere to send them things rather than something the account cannot exist
  // without — a supervisor is reached on their phone and signs in with it.
  email: z.string().email().optional(),
  societyId: z.string().min(1),
});
const staffPatchSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "blocked"]).optional(),
  // Moving a supervisor to another society. The employee id is not editable: it is
  // generated once and identifies the person everywhere else.
  societyId: z.string().min(1).optional(),
});
// An address in the parts an address is made of, and the towers the society is
// divided into. Blocks are named while the society is being set up because an
// operator is assigned to blocks: a society with none is a society whose work
// cannot be given to anybody.
const addressSchema = z.object({
  house: z.string().min(1),
  street: z.string().min(1),
  locality: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(6).max(6),
});
const societySchema = z.object({
  name: z.string().min(2),
  address: addressSchema,
  blocks: z.array(z.object({
    name: z.string().min(1).max(60),
    floorCount: z.number().int().positive().optional(),
    flatCount: z.number().int().positive().optional(),
  })).max(60).optional(),
});
// A tower is described by its name, its floors and its flats. Floors and flats are
// positive numbers: a tower of none of either is a typo, not a smaller building.
const blockSchema = z.object({
  name: z.string().min(1).max(60),
  floorCount: z.number().int().positive().optional(),
  flatCount: z.number().int().positive().optional(),
});
const blockPatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  floorCount: z.number().int().positive().optional(),
  flatCount: z.number().int().positive().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});
const blockOperatorsSchema = z.object({ operatorUserIds: z.array(z.string().min(1)).max(20) });
const societyPatchSchema = z.object({
  name: z.string().min(2).optional(),
  address: addressSchema.partial().optional(),
  status: z.enum(["active", "coming_soon", "inactive"]).optional(),
});
// One service inside a plan: what it is measured in, how much the plan includes,
// how often it may be used, and what happens when somebody wants more. All of it is
// configuration, because "40 kg of washing, and going over costs 60.00 per kg" is a
// business decision rather than a technical one.
const planServiceSchema = z.object({
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  unit: z.enum(["kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item"]),
  includedQuantity: z.number().nonnegative(),
  // The same frequencies a recurring pickup can be set to, so a plan cannot promise
  // a cadence the scheduler has no way of honouring. "Custom" is whatever days the
  // admin names, which is why frequencyDays is validated against the frequency
  // rather than simply accepted.
  frequency: z.enum(["one_time", "daily", "alternate_days", "twice_weekly", "weekly", "custom"]),
  frequencyDays: z.array(z.number().int().min(0).max(6)).default([]),
  maxPerFrequency: z.number().positive().nullable().optional(),
  maxPerCycle: z.number().positive().nullable().optional(),
  carryForward: z.boolean().default(false),
  additionalUsage: z.enum(["block", "pay_per_use", "admin_approval"]).default("pay_per_use"),
  additionalRatePaise: z.number().int().nonnegative().default(0),
});

const planSchema = z.object({ tier: z.string().min(2), garmentCap: z.number().int().positive(), turnaroundHours: z.number().int().positive(), monthlyPaise: z.number().int().nonnegative(), annualDiscountPercent: z.number().min(0).max(100).optional(), coveredServiceIds: z.array(z.string().min(1)).optional(), name: z.string().min(1).optional(), description: z.string().nullable().optional(), services: z.array(planServiceSchema).optional(), validity: z.enum(["monthly", "annual"]).optional(), taxPercent: z.number().min(0).max(100).optional(), discountPercent: z.number().min(0).max(100).optional() });
const planPatchSchema = z.object({ tier: z.string().min(2).optional(), garmentCap: z.number().int().positive().optional(), turnaroundHours: z.number().int().positive().optional(), monthlyPaise: z.number().int().nonnegative().optional(), annualDiscountPercent: z.number().min(0).max(100).optional(), isActive: z.boolean().optional(), coveredServiceIds: z.array(z.string().min(1)).optional(), name: z.string().min(1).optional(), description: z.string().nullable().optional(), services: z.array(planServiceSchema).optional() });
const serviceSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  name: z.string().min(2),
  unitPricePaise: z.number().int().nonnegative().default(0),
  // Price per garment category. A category left out falls back to unitPricePaise.
  pricesPaise: z.record(z.string(), z.number().int().nonnegative()).optional(),
  requiresClean: z.boolean().default(true),
  cleanStage: z.enum(["wash", "dry_clean", "premium"]).default("wash"),
  requiresPress: z.boolean().default(true),
  // What this service is measured in. Washing is weighed, ironing is counted, and
  // at-home work is charged by the hour; the unit is a property of the service
  // rather than an assumption made by whatever prices it.
  unit: z.enum(["kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item"]).default("piece"),
  // The smallest quantity it will bill for, where there is one.
  minimumBillable: z.number().positive().nullable().optional(),
  isBase: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
const servicePatchSchema = serviceSchema.partial().omit({ id: true });

// The window decides the times, so startTime and endTime are accepted for
// compatibility and ignored. See SLOT_WINDOWS.
const slotSchema = z.object({
  societyId: z.string(), date: z.string(),
  window: z.enum(["Morning", "Afternoon", "Evening"]),
  startTime: z.string().optional(), endTime: z.string().optional(),
  capacityTotal: z.number().int().positive(),
  // Held for residents on a plan. Left out, a slot is open to everybody.
  subscribersOnly: z.boolean().optional(),
});
// Approving or rejecting an account, with an optional word about why.
const verificationSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().optional(),
});
const configSchema = z.object({
  additionalGarmentRatePaise: z.number().int().nonnegative().optional(),
  nonSubscriberGarmentRatePaise: z.number().int().nonnegative().optional(),
  // Pay as you go price per garment category. Entirely separate from what a
  // subscription covers: changing one must never change the other.
  garmentPricesPaise: z.record(z.string(), z.number().int().nonnegative()).optional(),
  garmentServices: z.array(z.object({
    id: z.string().min(1), name: z.string().min(1),
    unitPricePaise: z.number().int().nonnegative(),
    pricesPaise: z.record(z.string(), z.number().int().nonnegative()).optional(),
    requiresClean: z.boolean().optional(),
    cleanStage: z.enum(["wash", "dry_clean", "premium"]).optional(),
    requiresPress: z.boolean().optional(),
    // What the service is measured in, and the smallest quantity it will bill for.
    // A weighed service that will not go below one kilogram says so here rather than
    // having the floor written into the pricing code.
    unit: z.enum(["kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item"]).optional(),
    minimumBillable: z.number().positive().nullable().optional(),
    isBase: z.boolean().default(false), isActive: z.boolean().default(true),
  })).min(1).optional(),
  garmentCategories: z.array(z.string().min(1)).min(1).optional(),
  defaultSlotCapacity: z.number().int().positive().optional(),
  defaultTurnaroundHours: z.number().int().positive().optional(),
  delayGraceHours: z.number().int().nonnegative().optional(),
  qcRequired: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
});
const issueStatusSchema = z.object({ status: z.enum(["in_progress", "waiting_resident", "waiting_operator", "escalated_supervisor", "escalated_admin", "resolved", "closed"]), resolution: z.string().optional() });
const issueReplySchema = z.object({ body: z.string().min(1) });
const availabilitySchema = z.object({ status: z.enum(["active", "on_leave", "blocked"]), reassignToUserId: z.string().nullable().optional(), reason: z.string().optional() });
// Times are not editable: they follow from the window. See SLOT_WINDOWS.
const slotPatchSchema = z.object({ window: z.enum(["Morning", "Afternoon", "Evening"]).optional(), capacityTotal: z.number().int().positive().optional(), isActive: z.boolean().optional(), subscribersOnly: z.boolean().optional() });

// The twelve steps of the service wizard, as one body. Every part is optional so a
// wizard can save what it has; what a service actually needs to be valid is decided
// by the domain, which names every problem at once rather than one at a time.
const UNIT_ENUM = z.enum(["kg", "piece", "hour", "job", "vehicle", "room", "sqft", "pair", "item"]);
const FREQUENCY_ENUM = z.enum(["one_time", "daily", "alternate_days", "twice_weekly", "weekly", "custom"]);

const servicePlanRuleSchema = z.object({
  planId: z.string().min(1),
  planName: z.string().min(1),
  mode: z.enum(["included", "fixed", "discounted", "percentage_discount", "additional_charge", "not_available"]),
  pricePaise: z.number().int().nonnegative().nullable().optional(),
  discountPercent: z.number().min(0).max(100).nullable().optional(),
  includedQuantity: z.number().nonnegative().nullable().optional(),
  frequency: FREQUENCY_ENUM.nullable().optional(),
  frequencyDays: z.array(z.number().int().min(0).max(6)).optional(),
  carryForward: z.boolean().optional(),
  additionalUsageAllowed: z.boolean().optional(),
  additionalRatePaise: z.number().int().nonnegative().nullable().optional(),
});

const serviceTimeSlotSchema = z.object({
  window: z.string().min(1),
  startTime: z.string().min(4),
  endTime: z.string().min(4),
  capacity: z.number().int().positive(),
  maxBookings: z.number().int().positive().nullable().optional(),
  subscriberAvailable: z.boolean().default(true),
  nonSubscriberAvailable: z.boolean().default(true),
});

const bookingRulesSchema = z.object({
  advanceBookingRequired: z.boolean().default(true),
  minAdvanceMinutes: z.number().int().nonnegative().default(120),
  maxAdvanceDays: z.number().int().positive().default(30),
  cancellationAllowed: z.boolean().default(true),
  cancellationDeadlineMinutes: z.number().int().nonnegative().default(60),
  reschedulingAllowed: z.boolean().default(true),
  maxBookingsPerUser: z.number().int().positive().nullable().optional(),
  maxQuantityPerBooking: z.number().positive().nullable().optional(),
});

const additionalChargeSchema = z.object({
  kind: z.enum(["service", "home_visit", "convenience", "emergency", "additional_unit", "weekend"]),
  label: z.string().optional(),
  amountPaise: z.number().int().nonnegative(),
  appliesOnWeekend: z.boolean().optional(),
  appliesAtHome: z.boolean().optional(),
});

const offeringSchema = z.object({
  // Step 1 — what it is.
  name: z.string().min(2),
  category: z.enum(["vehicle_care", "home_care", "other"]),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  kind: z.enum(["vehicle_wash", "home_ironing"]).optional(),
  vehicleTypes: z.array(z.string()).optional(),
  // Step 2 — how it is measured, and the quantities it accepts.
  unit: UNIT_ENUM,
  minimumQuantity: z.number().positive().nullable().optional(),
  maximumQuantity: z.number().positive().nullable().optional(),
  quantityIncrement: z.number().positive().nullable().optional(),
  // Step 3 — what it costs.
  unitPricePaise: z.number().int().nonnegative(),
  subscriberUnitPricePaise: z.number().int().nonnegative().nullable().optional(),
  // Steps 4 and 5 — what each plan does about it.
  planRules: z.array(servicePlanRuleSchema).optional(),
  // Step 6 — how often it may be booked.
  frequency: FREQUENCY_ENUM.nullable().optional(),
  frequencyDays: z.array(z.number().int().min(0).max(6)).optional(),
  // Step 7 — where it is offered and how the work is done.
  availabilityScope: z.enum(["all_societies", "selected_societies"]).optional(),
  societyIds: z.array(z.string()).optional(),
  mode: z.enum(["at_society", "at_home", "pickup_delivery", "at_home_and_pickup"]).optional(),
  operatingDays: z.array(z.number().int().min(0).max(6)).optional(),
  // Step 8 — the windows within those days.
  timeSlots: z.array(serviceTimeSlotSchema).optional(),
  // Step 9 — who may book it.
  eligibility: z.enum(["subscriber", "non_subscriber", "both"]).optional(),
  eligiblePlanIds: z.array(z.string()).optional(),
  // Step 10 — when.
  bookingRules: bookingRulesSchema.optional(),
  // Step 11 — the extras the platform applies.
  additionalCharges: z.array(additionalChargeSchema).optional(),
  minimumHours: z.number().positive().nullable().optional(),

  // The rest of the configuration. All optional, so a caller written before any of
  // it keeps working and a service without a section behaves as it always did.

  // Draft, active or inactive. A service being built needs somewhere to live that
  // is not "off": inactive is a service that used to be offered, which is a
  // different thing from one nobody has finished writing.
  status: z.enum(["draft", "active", "inactive"]).optional(),
  // What the resident chooses, and what they can add.
  options: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    priceDeltaPaise: z.number().int(),
    isActive: z.boolean(),
  })).optional(),
  addOns: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    pricePaise: z.number().int().nonnegative(),
    isActive: z.boolean(),
  })).optional(),
  // When it may be booked at all, and whether it is off for a while.
  availabilityWindow: z.object({
    startDate: z.string().nullable().optional(),
    endDate: z.string().nullable().optional(),
    suspended: z.boolean().optional(),
    suspendedReason: z.string().nullable().optional(),
  }).optional(),
  // What the operation can carry across all the slots, which is a different limit
  // from what one slot holds and usually the one reached first.
  capacity: z.object({
    maxBookingsPerDay: z.number().int().positive().nullable().optional(),
    maxBookingsPerSociety: z.number().int().positive().nullable().optional(),
    maxConcurrentJobs: z.number().int().positive().nullable().optional(),
  }).optional(),
  recurrence: z.object({
    enabled: z.boolean(),
    frequencies: z.array(FREQUENCY_ENUM),
  }).optional(),
  // Whose work it is, and what the work is.
  operations: z.object({
    team: z.string().nullable().optional(),
    operatorUserIds: z.array(z.string()).optional(),
    workflow: z.array(z.enum(["scheduled", "assigned", "in_progress", "qc", "completed"])).optional(),
  }).optional(),
  notifyOn: z.array(z.enum([
    "booked", "assigned", "scheduled", "started", "completed", "cancelled", "rescheduled", "delayed",
  ])).optional(),
  cancellationRules: z.object({
    feePaise: z.number().int().nonnegative().nullable().optional(),
    refundPercent: z.number().min(0).max(100).nullable().optional(),
  }).optional(),
  reschedulingRules: z.object({
    maxReschedules: z.number().int().nonnegative().nullable().optional(),
    deadlineMinutes: z.number().int().nonnegative().nullable().optional(),
  }).optional(),
});
const offeringPatchSchema = offeringSchema.partial();

// One society, and the blocks of it this operator covers. No verification codes and
// no employee id, for the same reasons a supervisor has neither.
const operatorSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().min(10).max(10),
  email: z.string().email(),
  societyId: z.string().min(1),
  blockIds: z.array(z.string().min(1)).default([]),
});
// The employee id is deliberately absent: it is generated once and never changes,
// so an edit that could rewrite it would be an edit that breaks every reference to
// the person it identifies.
const operatorPatchSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  status: z.enum(["active", "blocked"]).optional(),
  societyId: z.string().min(1).optional(),
  blockIds: z.array(z.string().min(1)).optional(),
});
const assignSchema = z.object({ operatorUserId: z.string().nullable().optional(), reason: z.string().optional() });


// A cell that cannot break the file: quotes doubled, and anything containing a
// comma, a quote or a newline wrapped.
function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Paise as rupees, for an export a person reads rather than a machine.
function rupees(paise: number | null): string {
  if (paise == null) return "";
  return (paise / 100).toFixed(2);
}

// The admin portal. Admin is the highest role and is never restricted to a society,
// so these routes read the whole platform. Everything that changes state is
// written to the audit log with its before and after value.
// What the admin issue query means, in one place. Used by the list and by the
// analytics beside it, so the two can never describe different sets of issues.
function adminIssueQuery(query: Record<string, string | undefined>) {
  return {
    status: query.status as never, type: query.type,
    priority: query.priority as never,
    escalatedOnly: query.escalated === "true",
    emergencyOnly: query.emergency === "true",
    openOnly: query.open === "true",
    from: query.from, to: query.to,
  };
}

// The parts that are not expressible in the service filter.
function adminIssueFilter(query: Record<string, string | undefined>, issues: SupportTicket[]): SupportTicket[] {
  let result = issues;
  if (query.societyId) result = result.filter((t) => t.societyId === query.societyId);
  if (query.assignment === "assigned") result = result.filter((t) => Boolean(t.assignedToUserId));
  if (query.assignment === "unassigned") result = result.filter((t) => !t.assignedToUserId);
  if (query.supervisorUserId) result = result.filter((t) => t.assignedToUserId === query.supervisorUserId);
  if (query.q) {
    const needle = query.q.toLowerCase();
    result = result.filter((t) =>
      t.id.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle) ||
      (t.orderId ?? "").toLowerCase().includes(needle) ||
      (t.residentId ?? "").toLowerCase().includes(needle));
  }
  return result;
}

export function registerAdminRoutes(app: FastifyInstance, container: Container): void {
  const admin = (req: Parameters<typeof requireRole>[0], reply: Parameters<typeof requireRole>[1]) =>
    requireRole(req, reply, container, "admin");

  // An operator belongs to one society and covers blocks inside it. A block from
  // another society is not a narrower permission but a wider one — it would quietly
  // grant a whole extra society, run by a different supervisor — so it is refused
  // here as well as in the form. A form that reloads its block list on a society
  // change still sends whatever ids it was given, and a caller that is not the form
  // sends whatever it likes.
  async function refuseBadAssignment(
    societyId: string | null,
    blockIds: string[],
  ): Promise<{ code: number; body: Record<string, unknown> } | null> {
    if (!societyId) {
      return { code: 422, body: { error: "society_required", message: "Choose the society this person works in." } };
    }
    const society = await container.store.societies.get(societyId);
    if (!society) return { code: 404, body: { error: "society_not_found" } };
    for (const id of blockIds) {
      const block = await container.store.blocks.get(id);
      if (!block) return { code: 404, body: { error: "block_not_found", message: "That block no longer exists." } };
      if (block.societyId !== societyId) {
        return {
          code: 422,
          body: {
            error: "block_outside_society",
            message: `${block.name} is not a block of ${society.name}.`,
          },
        };
      }
    }
    return null;
  }

  // Both sides of a block assignment, or the block's list of operators and the
  // operator's list of blocks disagree and the assignment screen shows one of them.
  async function syncBlockOperators(operatorUserId: string, blockIds: string[], session: Parameters<typeof container.audit.record>[0]["session"]) {
    const wanted = new Set(blockIds);
    for (const block of await container.store.blocks.all()) {
      const listed = block.operatorUserIds.includes(operatorUserId);
      if (wanted.has(block.id) === listed) continue;
      await container.store.blocks.put({
        ...block,
        operatorUserIds: wanted.has(block.id)
          ? [...block.operatorUserIds, operatorUserId]
          : block.operatorUserIds.filter((id) => id !== operatorUserId),
      });
    }
    await container.audit.record({
      session, action: "operator.blocks_assigned", resource: "user", resourceId: operatorUserId,
      previousValue: null, newValue: { blockIds },
    });
  }

  // ------------------------------------------------------- supervisor cover

  // Societies whose supervisor is unavailable, or which have none. The admin covers
  // these, which is why the slot, society and operator endpoints below exist at
  // admin level too.
  app.get("/v1/admin/coverage", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const societies = await container.store.societies.all();
    const coverage = await Promise.all(societies.map((s) => container.staffing.societyCoverage(s.id)));
    const rows = coverage.filter((c): c is NonNullable<typeof c> => Boolean(c));
    return reply.send({ coverage: rows, needingCover: rows.filter((c) => c.needsAdminCover) });
  });

  // Taking any staff member off duty. The account is kept and an operator's open
  // work is handed over in the same step.
  app.post<{ Params: { id: string } }>("/v1/admin/users/:id/availability", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = availabilitySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    if (req.params.id === session.userId) return reply.code(409).send({ error: "cannot_change_own_status" });
    try {
      const result = await container.staffing.setAvailability({
        userId: req.params.id, status: parsed.data.status,
        reassignToUserId: parsed.data.reassignToUserId ?? null,
        reason: parsed.data.reason, session,
      });
      return reply.send({
        user: await container.users.decorate(result.user),
        reassigned: result.reassigned, returnedToQueue: result.unassigned,
      });
    } catch (error) {
      if (error instanceof StaffingError) return reply.code(409).send({ error: "handover_failed", message: error.message });
      throw error;
    }
  });

  // Operations staff, system wide. Admin can create and move them in any society so
  // a supervisor being unavailable never blocks operations.
  //
  // Filtered by search, society, block, availability and supervisor — the things an
  // admin actually looks somebody up by. Area is gone, and so is a separate status
  // filter: availability already says whether somebody is on duty.
  app.get<{ Querystring: {
    q?: string; societyId?: string; blockId?: string;
    availability?: string; supervisorUserId?: string;
  } }>("/v1/admin/operators", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let operators = await container.users.listByRole("operator");
    if (req.query.societyId) operators = operators.filter((u) => (u.societyIds ?? []).includes(req.query.societyId!));
    if (req.query.blockId) operators = operators.filter((u) => (u.blockIds ?? []).includes(req.query.blockId!));
    if (req.query.availability && req.query.availability !== "all") {
      operators = operators.filter((u) => u.status === req.query.availability);
    }
    if (req.query.q) {
      const needle = req.query.q.trim().toLowerCase();
      operators = operators.filter((u) =>
        (u.fullName ?? "").toLowerCase().includes(needle) || u.phone.includes(needle));
    }
    let rows = await container.users.decorateAll(operators);
    // Filtered after decoration, because who an operator's supervisor is follows
    // from the society they work in rather than being a field on their record.
    if (req.query.supervisorUserId) {
      rows = rows.filter((r) => r.supervisorUserId === req.query.supervisorUserId);
    }
    // The dropdown options the filter row needs, alongside the rows themselves, so
    // the screen does not make a second and third call to render its own filters.
    const societies = await container.store.societies.all();
    const blocks = await container.store.blocks.all();
    return reply.send({
      operators: rows,
      societies: societies.map((s) => ({ id: s.id, name: s.name })),
      blocks: blocks
        .filter((b) => !req.query.societyId || b.societyId === req.query.societyId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({ id: b.id, name: b.name, societyId: b.societyId })),
      supervisors: (await container.users.listByRole("supervisor"))
        .map((u) => ({ id: u.id, fullName: u.fullName })),
    });
  });

  app.post("/v1/admin/operators", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = operatorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const problems = staffDetailProblems(parsed.data, { emailRequired: true });
    if (problems.length) return reply.code(422).send({ error: "invalid_details", problems });
    const refused = await refuseBadAssignment(parsed.data.societyId, parsed.data.blockIds);
    if (refused) return reply.code(refused.code).send(refused.body);
    try {
      const user = await container.users.createStaff({
        role: "operator",
        firstName: parsed.data.firstName, lastName: parsed.data.lastName,
        phone: parsed.data.phone, email: parsed.data.email,
        societyIds: [parsed.data.societyId], blockIds: parsed.data.blockIds,
      });
      await syncBlockOperators(user.id, parsed.data.blockIds, session);
      await container.audit.record({ session, action: "operator.created", resource: "user", resourceId: user.id, newValue: user });
      return reply.code(201).send({ operator: await container.users.decorate(user) });
    } catch (error) {
      if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/operators/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = operatorPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const target = await container.store.users.get(req.params.id);
    if (!target || !target.roles.includes("operator")) return reply.code(404).send({ error: "not_found" });
    const { societyId, blockIds, ...rest } = parsed.data;
    const society = societyId ?? target.societyIds?.[0] ?? null;
    if (blockIds || societyId) {
      const refused = await refuseBadAssignment(society, blockIds ?? target.blockIds ?? []);
      if (refused) return reply.code(refused.code).send(refused.body);
    }
    const result = await container.users.update(req.params.id, {
      ...rest,
      ...(society ? { societyIds: [society] } : {}),
      ...(blockIds ? { blockIds } : {}),
    });
    if (!result) return reply.code(404).send({ error: "not_found" });
    if (blockIds) await syncBlockOperators(req.params.id, blockIds, session);
    await container.audit.record({ session, action: "operator.updated", resource: "user", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ operator: await container.users.decorate(result.current) });
  });

  app.post<{ Params: { id: string } }>("/v1/admin/orders/:id/assign", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const order = await container.store.orders.get(req.params.id);
    if (!order) return reply.code(404).send({ error: "not_found" });
    try {
      const moved = await container.staffing.reassignOrder(order.id, parsed.data.operatorUserId ?? null, session, parsed.data.reason);
      const refreshed = await container.store.orders.get(order.id);
      return reply.send({ order: await container.orders.detail(refreshed!), reassigned: moved });
    } catch (error) {
      if (error instanceof StaffingError) return reply.code(409).send({ error: "assignment_failed", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/slots/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = slotPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await container.scheduling.updateSlot(req.params.id, parsed.data);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "slot.updated", resource: "slot", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
      return reply.send({ slot: result.current });
    } catch (error) {
      if (error instanceof SlotInPastError) return reply.code(409).send({ error: "slot_in_past", message: "A slot on a day that has passed is read only." });
      if (error instanceof SlotInUseError) return reply.code(409).send({ error: "slot_in_use", message: error.message });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/admin/slots/:id/cancel", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const existing = await container.store.slots.get(req.params.id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    let result;
    try {
      result = await container.scheduling.cancelSlot(req.params.id);
    } catch (error) {
      if (error instanceof SlotInPastError) return reply.code(409).send({ error: "slot_in_past", message: "A slot on a day that has passed is read only." });
      throw error;
    }
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "slot.cancelled", resource: "slot", resourceId: req.params.id, previousValue: existing, newValue: result.slot });
    return reply.send(result);
  });

  // --------------------------------------------------------------- dashboard

  app.get("/v1/admin/dashboard", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send(await container.dashboards.admin());
  });

  // ------------------------------------------------------------ supervisors

  app.get<{ Querystring: { status?: string; assigned?: string; q?: string } }>("/v1/admin/supervisors", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let supervisors = await container.users.listByRole("supervisor");
    if (req.query.status && req.query.status !== "all") {
      supervisors = supervisors.filter((u) => u.status === req.query.status);
    }
    // Assigned means "runs a society". It used to mean "holds an area", which was a
    // different question with a different answer.
    if (req.query.assigned === "false") supervisors = supervisors.filter((u) => (u.societyIds ?? []).length === 0);
    if (req.query.assigned === "true") supervisors = supervisors.filter((u) => (u.societyIds ?? []).length > 0);
    if (req.query.q) {
      const needle = req.query.q.trim().toLowerCase();
      supervisors = supervisors.filter((u) =>
        (u.fullName ?? "").toLowerCase().includes(needle) || u.phone.includes(needle));
    }
    const societies = await container.store.societies.all();
    return reply.send({
      supervisors: await container.users.decorateAll(supervisors),
      // Which societies could be given to somebody, and which are already spoken
      // for. Named rather than hidden: an admin should see why a society cannot be
      // chosen instead of wondering where it went.
      societies: societies.map((s) => ({
        id: s.id, name: s.name,
        supervisorUserId: s.supervisorUserId ?? null,
      })),
    });
  });

  app.post("/v1/admin/supervisors", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = supervisorSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const problems = staffDetailProblems(parsed.data);
    if (problems.length) return reply.code(422).send({ error: "invalid_details", problems });
    const society = await container.store.societies.get(parsed.data.societyId);
    if (!society) return reply.code(404).send({ error: "society_not_found" });
    // One society each. Refused before the account is made rather than after, so a
    // rejected assignment does not leave an orphaned supervisor behind.
    if (society.supervisorUserId) {
      const held = await container.store.users.get(society.supervisorUserId);
      return reply.code(409).send({
        error: "society_taken",
        message: `${society.name} is already run by ${held?.fullName ?? "another supervisor"}.`,
      });
    }
    try {
      const user = await container.users.createStaff({
        role: "supervisor",
        firstName: parsed.data.firstName, lastName: parsed.data.lastName,
        phone: parsed.data.phone, email: parsed.data.email,
        // The admin filling this in is the only person who could ever approve the
        // result, so creating the supervisor is the approval.
        vouchedBy: await container.store.users.get(session.userId),
      });
      await container.audit.record({ session, action: "supervisor.created", resource: "user", resourceId: user.id, newValue: user });
      await container.assignments.assignSupervisor({
        societyId: parsed.data.societyId, supervisorUserId: user.id, session, newlyCreated: true,
      });
      const assigned = (await container.store.users.get(user.id))!;
      return reply.code(201).send({ supervisor: await container.users.decorate(assigned) });
    } catch (error) {
      if (error instanceof UserConflictError) return reply.code(409).send({ error: "user_conflict", message: error.message });
      if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_failed", message: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/admin/supervisors/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const user = await container.store.users.get(req.params.id);
    if (!user || !user.roles.includes("supervisor")) return reply.code(404).send({ error: "not_found" });
    const societies = await container.store.societies.find((s) => s.supervisorUserId === user.id);
    const societyIds = new Set(societies.map((s) => s.id));
    const operators = await container.store.users.find(
      (u) => u.roles.includes("operator") && (u.societyIds ?? []).some((id) => societyIds.has(id)));
    const orders = await container.store.orders.find((o) => societyIds.has(o.societyId));
    const blocks = await container.store.blocks.find((b) => societyIds.has(b.societyId));
    return reply.send({
      supervisor: await container.users.decorate(user),
      societies: await container.societies.summaries(societies),
      blocks: blocks
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => ({
          id: b.id, name: b.name, societyId: b.societyId,
          flatCount: b.flatCount, floorCount: b.floorCount ?? 0, status: b.status,
        })),
      operators: await container.users.decorateAll(operators),
      orders: await container.orders.summarise(orders),
    });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/supervisors/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = staffPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { societyId, ...rest } = parsed.data;
    const result = await container.users.update(req.params.id, rest);
    if (!result) return reply.code(404).send({ error: "not_found" });
    // Moving a supervisor is a change to two records, so it goes through the one
    // place that writes both: the society's idea of who runs it and the
    // supervisor's own scope cannot be allowed to drift apart.
    if (societyId && societyId !== result.current.societyIds?.[0]) {
      try {
        await container.assignments.assignSupervisor({ societyId, supervisorUserId: req.params.id, session, releasePrevious: true });
      } catch (error) {
        if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_failed", message: error.message });
        throw error;
      }
    }
    const current = (await container.store.users.get(req.params.id))!;
    await container.audit.record({ session, action: "supervisor.updated", resource: "user", resourceId: req.params.id, previousValue: result.previous, newValue: current });
    return reply.send({ supervisor: await container.users.decorate(current) });
  });

  // ------------------------------------------------------------- societies

  app.get<{ Querystring: { supervisorUserId?: string; q?: string; status?: string } }>("/v1/admin/societies", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let societies = await container.store.societies.all();
    if (req.query.supervisorUserId) {
      societies = societies.filter((s) => s.supervisorUserId === req.query.supervisorUserId);
    }
    if (req.query.status) societies = societies.filter((s) => s.status === req.query.status);
    // A search over the name is the whole filter row. There is no area to narrow by,
    // and a society code no longer exists to search for.
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      societies = societies.filter((s) => s.name.toLowerCase().includes(q));
    }
    return reply.send({
      societies: await container.societies.summaries(societies),
      // The states the address form offers. Sent with the list the form is opened
      // from, so the client neither invents the list nor makes a call for it.
      supportedStates: STATES,
    });
  });

  app.post("/v1/admin/societies", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = societySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const { society, blockCount } = await container.societies.create(parsed.data);
      await container.audit.record({ session, action: "society.created", resource: "society", resourceId: society.id, newValue: { ...society, blockCount } });
      return reply.code(201).send({ society: await container.societies.summary(society) });
    } catch (error) {
      // A duplicate is a conflict; a badly formed address is the caller's mistake
      // and every part of it is named at once, rather than one field per attempt.
      if (error instanceof SocietyConflictError) return reply.code(409).send({ error: "society_conflict", message: error.message });
      if (error instanceof SocietyInvalidError) return reply.code(422).send({ error: "invalid_society", problems: error.problems, message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/societies/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = societyPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await container.societies.update(req.params.id, parsed.data);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({
        session, action: parsed.data.status ? "society.status_changed" : "society.updated",
        resource: "society", resourceId: req.params.id, previousValue: result.previous, newValue: result.current,
      });
      return reply.send({ society: await container.societies.summary(result.current) });
    } catch (error) {
      if (error instanceof SocietyConflictError) return reply.code(409).send({ error: "society_conflict", message: error.message });
      if (error instanceof SocietyInvalidError) return reply.code(422).send({ error: "invalid_society", problems: error.problems, message: error.message });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>("/v1/admin/societies/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const society = await container.store.societies.get(req.params.id);
    if (!society) return reply.code(404).send({ error: "not_found" });
    const residents = await container.store.residents.find((r) => r.societyId === society.id);
    const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
    const blocks = await container.store.blocks.find((b) => b.societyId === society.id);
    const blockNames = new Map(blocks.map((b) => [b.id, b.name]));
    const orders = await container.store.orders.find((o) => o.societyId === society.id);
    return reply.send({
      society: await container.societies.summary(society),
      residents: residents.map((r) => ({
        ...r,
        blockName: r.blockId ? blockNames.get(r.blockId) ?? r.towerBlock : r.towerBlock,
        fullName: users.get(r.userId)?.fullName ?? null,
        phone: users.get(r.userId)?.phone ?? null,
        status: users.get(r.userId)?.status ?? null,
      })),
      operators: await container.users.decorateAll(await container.store.users.find((u) => u.roles.includes("operator") && u.societyIds.includes(society.id))),
      slots: await container.scheduling.listSlots({ societyId: society.id }),
      orders: await container.orders.summarise(orders),
    });
  });

  // ------------------------------------------------------- assignments

  // Society → Supervisor → Blocks → Operators, on one screen. The chain used to be
  // implied by two fields on a user record, so nothing could show a society and say
  // who ran it, or show a tower and say who collected from it.

  app.get<{ Params: { id: string } }>("/v1/admin/societies/:id/assignments", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const allocation = await container.assignments.allocation(req.params.id);
    if (!allocation) return reply.code(404).send({ error: "not_found" });
    // Who could be given this society, and who could be put on its blocks. Sent with
    // the allocation so the screen has its dropdown options without a second call.
    const staff = await container.store.users.all();
    const societies = await container.store.societies.all();
    const taken = new Map(societies
      .filter((s) => s.supervisorUserId && s.id !== req.params.id)
      .map((s) => [s.supervisorUserId!, s.name]));
    return reply.send({
      ...allocation,
      supervisorOptions: staff
        .filter((u) => u.roles.includes("supervisor") && u.status === "active"
          && (u.verificationStatus ?? "approved") === "approved")
        .map((u) => ({
          id: u.id, fullName: u.fullName, phone: u.phone, employeeId: u.employeeId,
          // Named rather than hidden: an admin should see why somebody cannot be
          // chosen instead of wondering where they went.
          heldSocietyName: taken.get(u.id) ?? null,
        })),
      operatorOptions: staff
        .filter((u) => u.roles.includes("operator") && u.status !== "blocked" && u.status !== "deleted"
          && (u.verificationStatus ?? "approved") === "approved")
        .map((u) => ({ id: u.id, fullName: u.fullName, phone: u.phone, status: u.status })),
    });
  });

  app.put<{ Params: { id: string } }>("/v1/admin/societies/:id/supervisor", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = z.object({ supervisorUserId: z.string().min(1).nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const society = await container.assignments.assignSupervisor({
        societyId: req.params.id, supervisorUserId: parsed.data.supervisorUserId, session,
      });
      return reply.send({ society: await container.societies.summary(society) });
    } catch (error) {
      if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_refused", message: error.message });
      throw error;
    }
  });

  app.post<{ Params: { id: string } }>("/v1/admin/societies/:id/blocks", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = blockSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const block = await container.assignments.createBlock({ societyId: req.params.id, ...parsed.data, session });
      return reply.code(201).send({ block });
    } catch (error) {
      if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_refused", message: error.message });
      throw error;
    }
  });

  app.patch<{ Params: { blockId: string } }>("/v1/admin/blocks/:blockId", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = blockPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      return reply.send({ block: await container.assignments.updateBlock(req.params.blockId, parsed.data, session) });
    } catch (error) {
      if (error instanceof AssignmentError) return reply.code(404).send({ error: "assignment_refused", message: error.message });
      throw error;
    }
  });

  app.put<{ Params: { blockId: string } }>("/v1/admin/blocks/:blockId/operators", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = blockOperatorsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const block = await container.assignments.setBlockOperators({
        blockId: req.params.blockId, operatorUserIds: parsed.data.operatorUserIds, session,
      });
      return reply.send({ block });
    } catch (error) {
      if (error instanceof AssignmentError) return reply.code(409).send({ error: "assignment_refused", message: error.message });
      throw error;
    }
  });

  // ------------------------------------------------------------------ users

  // Supervisors, operators and residents. Admin accounts are deliberately absent:
  // this page manages the people who run the operation, and an admin account is
  // managed through the platform's own administrative configuration rather than by
  // another admin on a list where it sits next to a resident.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/users", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let users = (await container.store.users.all()).filter((u) => !u.roles.includes("admin"));
    if (req.query.role && req.query.role !== "all") users = users.filter((u) => u.roles.includes(req.query.role as never));
    if (req.query.status && req.query.status !== "all") users = users.filter((u) => u.status === req.query.status);
    const residentRecords = await container.store.residents.all();
    // A society is a fact about staff through their assignment and about a resident
    // through where they live, so filtering by one has to look at both.
    if (req.query.societyId && req.query.societyId !== "all") {
      const wanted = req.query.societyId;
      const homes = new Map(residentRecords.map((r) => [r.userId, r.societyId]));
      users = users.filter((u) => (u.societyIds ?? []).includes(wanted) || homes.get(u.id) === wanted);
    }
    if (req.query.onboarding) {
      const want = req.query.onboarding === "completed";
      const byUser = new Map(residentRecords.map((r) => [r.userId, r]));
      users = users.filter((u) => Boolean(byUser.get(u.id)?.onboardingCompleted) === want);
    }
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      users = users.filter((u) => (u.fullName ?? "").toLowerCase().includes(q) || u.phone.includes(q) || (u.email ?? "").toLowerCase().includes(q));
    }
    const residents = new Map(residentRecords.map((r) => [r.userId, r]));
    const societyList = await container.store.societies.all();
    const societies = new Map(societyList.map((s) => [s.id, s]));
    const blocks = new Map((await container.store.blocks.all()).map((b) => [b.id, b]));
    // Only the page is decorated, so the work no longer grows with the user table.
    const page = paginate(users, req.query);
    const decorated = await container.users.decorateAll(page.items);
    return reply.send({
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      // The societies the filter offers, sent with the rows so the screen renders
      // its own filter row without a second call.
      societies: societyList.map((s) => ({ id: s.id, name: s.name })),
      users: decorated.map((u) => {
        const resident = residents.get(u.id);
        const home = resident ? societies.get(resident.societyId) ?? null : null;
        return {
          ...u,
          residentSocietyId: resident?.societyId ?? null,
          residentSocietyName: home?.name ?? null,
          // One column for the table, whichever way this person is attached to a
          // society: staff through their assignment, a resident through their flat.
          societyLabel: u.societyName ?? home?.name ?? null,
          blockName: resident?.blockId ? blocks.get(resident.blockId)?.name ?? resident.towerBlock : resident?.towerBlock ?? null,
          unitNumber: resident?.unitNumber ?? null,
          onboardingCompleted: resident?.onboardingCompleted ?? null,
        };
      }),
    });
  });

  // Blocking and deactivating are two different things, and the Users page needs
  // both.
  //
  // This used to accept only "active" and "blocked", and the screen labelled the
  // blocked one "Deactivate" — so there was one switch with two names and no way
  // to say "this person is suspended for now" separately from "this account is
  // finished". Blocking is a hold: the account and everything on it stays, and the
  // person is let back in by unblocking. Deactivating retires the account.
  //
  // Both refuse a sign-in — `auth-service` admits only an active user — and
  // neither touches society or block assignments, so a blocked or retired operator
  // comes back to the towers they had.
  const USER_STATUSES = ["active", "blocked", "deleted"] as const;
  const STATUS_ACTION: Record<(typeof USER_STATUSES)[number], string> = {
    active: "user.activated", blocked: "user.blocked", deleted: "user.deactivated",
  };

  app.patch<{ Params: { id: string }; Body: { status?: (typeof USER_STATUSES)[number] } }>("/v1/admin/users/:id/status", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const status = (req.body ?? {}).status;
    if (!status || !USER_STATUSES.includes(status)) return reply.code(400).send({ error: "invalid_request" });
    if (req.params.id === session.userId) return reply.code(409).send({ error: "cannot_change_own_status" });

    const subject = await container.store.users.get(req.params.id);
    if (!subject) return reply.code(404).send({ error: "not_found" });
    // An admin is not blocked or retired from this screen. Locking the
    // administrators out of the platform is not an action a list of users should
    // offer in passing, and one admin doing it to another is how a platform ends
    // up with nobody who can undo it.
    if (subject.roles.includes("admin") && status !== "active") {
      return reply.code(409).send({
        error: "admin_status_restricted",
        message: "An administrator cannot be blocked or deactivated from the users list.",
      });
    }

    const result = await container.users.setStatus(req.params.id, status);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({
      session, action: STATUS_ACTION[status],
      resource: "user", resourceId: req.params.id,
      previousValue: { status: result.previous.status }, newValue: { status },
    });
    return reply.send({ user: await container.users.decorate(result.current) });
  });

  // ----------------------------------------------------------------- orders

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/orders", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    let orders = await container.store.orders.all();
    const q = req.query;
    if (q.societyId) orders = orders.filter((o) => o.societyId === q.societyId);
    if (q.blockId) orders = orders.filter((o) => o.blockId === q.blockId);
    if (q.state) orders = orders.filter((o) => o.state === q.state);
    if (q.residentId) orders = orders.filter((o) => o.residentId === q.residentId);
    if (q.from || q.to) orders = orders.filter((o) => withinServiceDays(o.createdAt, q.from, q.to));
    if (q.supervisorUserId) {
      const run = await container.store.societies.find((sc) => sc.supervisorUserId === q.supervisorUserId);
      const runIds = new Set(run.map((sc) => sc.id));
      orders = orders.filter((o) => runIds.has(o.societyId));
    }
    if (q.orderCode) orders = orders.filter((o) => o.orderCode.toLowerCase().includes(q.orderCode!.toLowerCase()));
    if (q.operatorUserId) orders = orders.filter((o) => o.assignedOperatorUserId === q.operatorUserId);
    if (q.unassigned === "true") orders = orders.filter((o) => !o.assignedOperatorUserId);
    if (q.payment) {
      orders = q.payment === "pending"
        ? orders.filter((o) => o.additionalChargeStatus === "pending" || o.additionalChargeStatus === "failed")
        : orders.filter((o) => o.additionalChargeStatus === q.payment);
    }
    // The operation's day, not UTC's, so "today" before dawn still means today.
    if (q.today === "true") orders = orders.filter((o) => serviceDay(o.createdAt) === today());
    if (q.resident) {
      const term = q.resident.toLowerCase();
      const users = await container.store.users.all();
      const residents = await container.store.residents.all();
      const matching = new Set(residents
        .filter((r) => {
          const user = users.find((u) => u.id === r.userId);
          return (user?.fullName ?? "").toLowerCase().includes(term) || (user?.phone ?? "").includes(term);
        })
        .map((r) => r.id));
      orders = orders.filter((o) => matching.has(o.residentId));
    }
    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    let summaries = await container.orders.summarise(orders);
    // Delayed is derived rather than stored, so it is filtered after summarising.
    if (q.delayed === "true") summaries = summaries.filter((o) => o.delayed);
    // Paged, because this list grows with the platform and a client only ever shows
    // a screen of it. The totals describe the whole match, not the page.
    const page = paginate(summaries, q);
    return reply.send({ orders: page.items, page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore }, stateLabels: STATE_LABELS });
  });

  // The subscription tiles on the dashboard drill into this.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/subscriptions", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let subs = await container.store.subscriptions.all();
    if (req.query.status) subs = subs.filter((s) => s.status === req.query.status);
    if (req.query.planId) subs = subs.filter((s) => s.planId === req.query.planId);
    const plans = new Map((await container.store.plans.all()).map((p) => [p.id, p]));
    const residents = new Map((await container.store.residents.all()).map((r) => [r.id, r]));
    const users = new Map((await container.store.users.all()).map((u) => [u.id, u]));
    const societies = new Map((await container.store.societies.all()).map((s) => [s.id, s]));
    // Filtered by society here rather than at the store, because which society a
    // subscription belongs to is a fact about its resident.
    if (req.query.societyId) {
      subs = subs.filter((s) => residents.get(s.residentId)?.societyId === req.query.societyId);
    }
    // Paged like every other list that grows with the platform. The totals
    // describe the whole match, so "1–10 of 84" counts what the filters selected
    // and not what happened to be sent.
    const page = paginate(subs, req.query);
    return reply.send({
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      subscriptions: page.items.map((sub) => {
        const resident = residents.get(sub.residentId);
        const user = resident ? users.get(resident.userId) : null;
        const plan = plans.get(sub.planId);
        return {
          ...sub,
          planTier: plan?.tier ?? null, monthlyPaise: plan?.monthlyPaise ?? null,
          allowance: plan?.garmentCap ?? null,
          remaining: plan ? Math.max(0, plan.garmentCap - sub.garmentsUsed) : null,
          residentName: user?.fullName ?? null, residentPhone: user?.phone ?? null,
          societyName: resident ? societies.get(resident.societyId)?.name ?? null : null,
        };
      }),
    });
  });

  // The revenue tiles drill into this rather than showing only a total.
  // Revenue over a period, narrowed to a place or a person, broken down so the
  // total can be explained rather than only stated. The old shape is kept alongside
  // the new one so nothing that already reads this endpoint breaks.
  app.get<{ Querystring: {
    preset?: string; from?: string; to?: string;
    societyId?: string; blockId?: string; supervisorUserId?: string; operatorUserId?: string;
    planId?: string; paymentStatus?: string;
  } }>("/v1/admin/revenue", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const q = req.query;
    const report = await container.revenue.report({
      preset: (q.preset as never) || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      societyId: q.societyId || undefined,
      blockId: q.blockId || undefined,
      supervisorUserId: q.supervisorUserId || undefined,
      operatorUserId: q.operatorUserId || undefined,
      planId: q.planId || undefined,
      paymentStatus: q.paymentStatus || undefined,
    });

    // The figures the previous version of this endpoint returned, unchanged.
    const legacy = await container.reports.revenueReport(session, { from: report.range.from, to: report.range.to });
    return reply.send({
      ...report,
      summary: { ...legacy, ...report.summary },
      // The options every filter control offers, so the client never invents them.
      filters: {
        societies: (await container.store.societies.all()).map((sc) => ({ id: sc.id, name: sc.name })),
        blocks: (await container.store.blocks.all())
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((b) => ({ id: b.id, name: b.name, societyId: b.societyId })),
        supervisors: (await container.store.users.find((u) => u.roles.includes("supervisor")))
          .map((u) => ({ id: u.id, name: u.fullName, societyIds: u.societyIds ?? [] })),
        operators: (await container.store.users.find((u) => u.roles.includes("operator")))
          .map((u) => ({ id: u.id, name: u.fullName, societyIds: u.societyIds, blockIds: u.blockIds ?? [] })),
        plans: (await container.subscriptions.listPlans(true)).map((pl) => ({ id: pl.id, name: pl.tier })),
      },
    });
  });

  app.get<{ Params: { id: string } }>("/v1/admin/orders/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    return withScope(reply, async () => {
      const order = await container.access.requireOrder(session, req.params.id);
      return reply.send({ order: await container.orders.detail(order) });
    });
  });

  // ------------------------------------------------------------------ plans

  app.get("/v1/admin/plans", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ plans: await container.subscriptions.planUsage() });
  });

  app.post("/v1/admin/plans", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const plan = await container.subscriptions.createPlan(parsed.data);
      await container.audit.record({ session, action: "plan.created", resource: "plan", resourceId: plan.id, newValue: plan });
      // What it will actually cost, worked out once here rather than in the client.
      return reply.code(201).send({ plan, pricing: container.subscriptions.pricingFor(plan) });
    } catch (error) {
      // Everything wrong with the plan at once, so a wizard can mark every step that
      // still needs attention rather than revealing the problems one at a time.
      if (error instanceof InvalidPlanError) return reply.code(400).send({ error: "invalid_plan", message: error.message, problems: error.problems });
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/plans/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = planPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await container.subscriptions.updatePlan(req.params.id, parsed.data);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "plan.updated", resource: "plan", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
      return reply.send({
        plan: result.current,
        pricing: container.subscriptions.pricingFor(result.current),
        // How many residents this change actually reaches. A change to a plan that
        // nobody is on is not the same act as one that reaches a hundred people, and
        // the admin is told which it was.
        activeSubscriptions: result.activeSubscriptions,
      });
    } catch (error) {
      if (error instanceof InvalidPlanError) return reply.code(400).send({ error: "invalid_plan", message: error.message, problems: error.problems });
      throw error;
    }
  });


  // ----------------------------------------------------------------- services

  // The Services page. One list, narrowed by whatever the admin is looking for —
  // no dashboard, no statistics, nothing but the services and what can be done to
  // them.
  app.get<{ Querystring: { q?: string; category?: string; eligibility?: string; status?: string; unit?: string } }>(
    "/v1/admin/services", async (req, reply) => {
      if (!(await admin(req, reply))) return;
      const found = await container.serviceRequests.listOfferings({
        q: req.query.q || undefined,
        category: (req.query.category || undefined) as never,
        eligibility: (req.query.eligibility || undefined) as never,
        status: (req.query.status || undefined) as never,
        unit: (req.query.unit || undefined) as never,
      });
      return reply.send({
        services: found.map((offering) => container.serviceRequests.describeOffering(offering)),
        // The vocabulary the filters are built from, so the client never keeps its
        // own copy of a list the backend can change.
        filters: {
          categories: SERVICE_CATEGORIES.map((key) => ({ key, label: SERVICE_CATEGORY_LABELS[key] })),
          eligibilities: CUSTOMER_ELIGIBILITIES,
          units: MEASUREMENT_UNITS,
          statuses: ["active", "inactive"],
        },
      });
    });

  // The same list, as a file. Exported from the same query as the page, so what is
  // exported is what was on screen rather than everything regardless of the filters.
  app.get<{ Querystring: { q?: string; category?: string; eligibility?: string; status?: string; unit?: string } }>(
    "/v1/admin/services/export", async (req, reply) => {
      if (!(await admin(req, reply))) return;
      const found = await container.serviceRequests.listOfferings({
        q: req.query.q || undefined,
        category: (req.query.category || undefined) as never,
        eligibility: (req.query.eligibility || undefined) as never,
        status: (req.query.status || undefined) as never,
        unit: (req.query.unit || undefined) as never,
      });
      const header = ["Service", "Category", "Unit", "Subscriber price", "Non-subscriber price", "Availability", "Status"];
      const rows = found.map((offering) => {
        const row = container.serviceRequests.describeOffering(offering);
        return [
          row.name,
          row.categoryLabel,
          row.unit,
          row.includedInPlans.length ? `Included in ${row.includedInPlans.join(" / ")}` : rupees(row.subscriberPricePaise),
          rupees(row.nonSubscriberPricePaise),
          row.availability,
          row.isActive ? "Active" : "Inactive",
        ];
      });
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", 'attachment; filename="services.csv"');
      return reply.send([header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"));
    });

  app.get<{ Params: { id: string } }>("/v1/admin/services/:id", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const offering = await container.store.offerings.get(req.params.id);
    if (!offering) return reply.code(404).send({ error: "not_found" });
    // The whole configuration, because Edit opens the same wizard pre-filled.
    return reply.send({ service: offering, bookings: (await container.serviceRequests.offeringBookings(offering.id)).length });
  });

  app.post("/v1/admin/services", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = offeringSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const service = await container.serviceRequests.createOffering(parsed.data as never);
      await container.audit.record({ session, action: "service.created", resource: "service", resourceId: service.id, newValue: service });
      return reply.code(201).send({ service });
    } catch (error) {
      if (error instanceof InvalidOfferingError) {
        return reply.code(400).send({ error: "invalid_service", message: error.message, problems: error.problems });
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/services/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = offeringPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const result = await container.serviceRequests.updateOffering(req.params.id, parsed.data as never);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "service.updated", resource: "service", resourceId: req.params.id, previousValue: result.previous, newValue: result.current });
      // Bookings already made are untouched, and the admin is told how many there
      // are rather than changing a service without knowing what it reaches.
      return reply.send({ service: result.current, openBookings: result.openBookings });
    } catch (error) {
      if (error instanceof InvalidOfferingError) {
        return reply.code(400).send({ error: "invalid_service", message: error.message, problems: error.problems });
      }
      throw error;
    }
  });

  // Copying an existing service is how most new ones actually get made. The copy is
  // created inactive, so it is never put in front of residents half configured.
  app.post<{ Params: { id: string } }>("/v1/admin/services/:id/duplicate", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const name = (req.body as { name?: string } | undefined)?.name;
    const copy = await container.serviceRequests.duplicateOffering(req.params.id, name);
    if (!copy) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "service.duplicated", resource: "service", resourceId: copy.id, newValue: copy });
    return reply.code(201).send({ service: copy });
  });

  // What is already booked against a service. This is why deactivating is the right
  // action rather than deleting: the bookings outlive the offering.
  app.get<{ Params: { id: string } }>("/v1/admin/services/:id/bookings", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const offering = await container.store.offerings.get(req.params.id);
    if (!offering) return reply.code(404).send({ error: "not_found" });
    return reply.send({ bookings: await container.serviceRequests.offeringBookings(req.params.id) });
  });

  // ------------------------------------------------------------------ slots

  // Slot monitoring across every society, with the filters that let an admin find
  // where capacity is short and where it is going to waste.
  app.get<{ Querystring: {
    societyId?: string; supervisorUserId?: string; operatorUserId?: string;
    from?: string; to?: string; date?: string; shift?: string;
    status?: string; bookingStatus?: string; utilisation?: string; includePast?: string;
  } }>("/v1/admin/slots", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const q = req.query;
    const result = await container.scheduling.monitorSlots({
      societyId: q.societyId || undefined,
      supervisorUserId: q.supervisorUserId || undefined,
      operatorUserId: q.operatorUserId || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
      date: q.date || undefined,
      shift: q.shift || undefined,
      status: (q.status as never) || undefined,
      bookingStatus: (q.bookingStatus as never) || undefined,
      utilisation: q.utilisation || undefined,
      includePast: q.includePast === "true",
    });
    return reply.send({
      ...result,
      // The values the filter controls offer, so the client never hard codes them.
      shifts: SHIFTS,
      // The fixed windows, so the client never invents a start or end time.
      slotWindows: SLOT_WINDOWS,
      statuses: ["open", "full", "cancelled", "closed"],
      bookingStatuses: ["available", "partially_booked", "fully_booked"],
      utilisationBands: ["0-25", "26-50", "51-75", "76-99", "100"],
    });
  });

  app.post("/v1/admin/slots", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const slot = await container.scheduling.createSlot(parsed.data);
      await container.audit.record({ session, action: "slot.created", resource: "slot", resourceId: slot.id, newValue: slot });
      return reply.code(201).send({ slot });
    } catch (error) {
      if (error instanceof SlotInPastError) return reply.code(400).send({ error: "slot_in_past", message: error.message });
      if (error instanceof UnknownSlotWindowError) return reply.code(400).send({ error: "unknown_slot_window", message: error.message });
      if (error instanceof SlotTooSoonError) return reply.code(422).send({ error: "slot_too_soon", message: error.message });
      if (error instanceof DuplicateSlotError) return reply.code(409).send({ error: "slot_exists", message: error.message });
      throw error;
    }
  });

  // --------------------------------------------------------------- reports

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/reports", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const filter = { from: req.query.from, to: req.query.to, blockId: req.query.blockId, societyId: req.query.societyId, supervisorUserId: req.query.supervisorUserId, state: req.query.state };
    const [byBlock, bySociety, bySupervisor, byOperator, residents, subscriptions, issues, revenue] = await Promise.all([
      container.reports.byBlock(session, filter),
      container.reports.bySociety(session, filter),
      container.reports.bySupervisor(session, filter),
      container.reports.byOperator(session, filter),
      container.reports.residentStatistics(session),
      container.reports.subscriptionReport(session),
      container.reports.issueReport(session, filter),
      container.reports.revenueReport(session, filter),
    ]);
    return reply.send({ byBlock, bySociety, bySupervisor, byOperator, residents, subscriptions, issues, revenue });
  });

  app.get("/v1/admin/reports/subscriptions", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.subscriptions()); });
  app.get("/v1/admin/reports/revenue", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.revenue()); });
  app.get("/v1/admin/reports/operations", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.operations()); });
  app.get("/v1/admin/reports/sustainability", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.sustainability()); });
  app.get("/v1/admin/reports/garment-risk", async (req, reply) => { if (!(await admin(req, reply))) return; return reply.send(await container.reports.garmentRisk()); });

  // ---------------------------------------------------------------- issues

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/issues", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const filtered = adminIssueFilter(req.query, await container.issues.list(adminIssueQuery(req.query)));
    const page = paginate(filtered, req.query);
    return reply.send({
      // Only the page is decorated, so the cost of rendering a list no longer grows
      // with the number of issues that exist.
      issues: await container.issues.details(page.items, { userId: session.userId, roles: session.roles, residentId: session.residentId }),
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
      issueTypes: ISSUE_TYPES, priorities: ISSUE_PRIORITIES,
    });
  });

  // Everything the admin support dashboard reports: volumes, ageing, average
  // resolution time and supervisor by supervisor performance.
  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/issues/analytics", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    // The same filters the list takes. The analytics used to be computed over every
    // issue ever raised while the list beside them was filtered, so the cards and the
    // rows under them described different sets and the cards looked simply wrong.
    const issues = adminIssueFilter(req.query, await container.issues.list(adminIssueQuery(req.query)));
    return reply.send({
      analytics: await container.issues.analytics(issues),
      // Said outright, so a reader knows whether they are looking at everything.
      filtered: Boolean(
        req.query.status || req.query.type || req.query.societyId ||
        req.query.priority || req.query.escalated || req.query.emergency ||
        req.query.open || req.query.from || req.query.to,
      ),
    });
  });

  app.get<{ Params: { id: string } }>("/v1/admin/issues/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const issue = await container.store.tickets.get(req.params.id);
    if (!issue) return reply.code(404).send({ error: "not_found" });
    return reply.send({ issue: await container.issues.detail(issue, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
  });

  app.post<{ Params: { id: string } }>("/v1/admin/issues/:id/reply", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = issueReplySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    let updated;
      try {
        updated = await container.issues.reply(req.params.id, session.userId, "admin", parsed.data.body, { roles: session.roles, residentId: session.residentId });
      } catch (error) {
        // Read-only rather than forbidden: this person can see the conversation, they
        // just cannot add to it while it is somebody else's to answer.
        if (error instanceof ConversationClosedError) return reply.code(409).send({ error: "conversation_read_only", message: error.message });
        throw error;
      }
    if (!updated) return reply.code(404).send({ error: "not_found_or_closed" });
    if (updated.residentId) {
      await container.notifications.notifyResident(updated.residentId, {
        type: "issue.replied", orderId: updated.orderId,
        title: "Support replied to your ticket", body: parsed.data.body,
      });
    }
    return reply.send({ issue: await container.issues.detail(updated, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/issues/:id/status", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = issueStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    try {
      const result = await container.issues.setStatus(req.params.id, parsed.data.status, { resolution: parsed.data.resolution, actorUserId: session.userId });
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.status_changed", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: parsed.data.status } });
      return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    } catch (error) {
      if (error instanceof IssueTransitionError) return reply.code(409).send({ error: "illegal_ticket_transition", message: error.message });
      throw error;
    }
  });

  // An admin is the last resort for an issue, so they close it and, when a decision
  // turns out to be wrong, reopen it. Before this an admin could resolve a ticket but
  // not close it, and reopening only happened as a side effect of a resident replying.
  app.post<{ Params: { id: string }; Body: { resolution?: string } }>("/v1/admin/issues/:id/close", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    try {
      const result = await container.issues.setStatus(req.params.id, "closed", {
        resolution: (req.body ?? {}).resolution, actorUserId: session.userId,
      });
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "issue.closed", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: "closed" } });
      return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
    } catch (error) {
      if (error instanceof IssueTransitionError) return reply.code(409).send({ error: "illegal_ticket_transition", message: error.message });
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: { reason?: string } }>("/v1/admin/issues/:id/reopen", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const reason = String((req.body ?? {}).reason ?? "").trim();
    if (!reason) return reply.code(400).send({ error: "invalid_request", message: "Say why it is being reopened." });
    const result = await container.issues.reopen(req.params.id, reason, session.userId);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "issue.reopened", resource: "issue", resourceId: req.params.id, previousValue: { status: result.previous.status }, newValue: { status: result.current.status, reason } });
    return reply.send({ issue: await container.issues.detail(result.current, undefined, { userId: session.userId, roles: session.roles, residentId: session.residentId }) });
  });

  // ------------------------------------------------------ staff verification

  // Whoever manages an account decides whether it may be used. An admin decides
  // about supervisors and may decide about anybody; a supervisor decides about the
  // operators in their own society.
  app.get<{ Querystring: { status?: string; role?: string } }>("/v1/admin/staff/pending", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    const wanted = req.query.status ?? "pending";
    let staff = await container.store.users.find((u) =>
      (u.roles.includes("supervisor") || u.roles.includes("operator")) &&
      (u.verificationStatus ?? "approved") === wanted);
    if (req.query.role) staff = staff.filter((u) => u.roles.includes(req.query.role as never));
    return reply.send({ staff: await container.users.decorateAll(staff), status: wanted });
  });

  app.post<{ Params: { id: string }; Body: { status?: string; note?: string } }>("/v1/admin/staff/:id/verification", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = verificationSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const actor = await container.store.users.get(session.userId);
    if (!actor) return reply.code(401).send({ error: "unauthorized" });
    try {
      const result = await container.users.setVerification(req.params.id, parsed.data.status, actor, parsed.data.note);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({
        session, action: `staff.${parsed.data.status}`, resource: "user", resourceId: req.params.id,
        previousValue: { verificationStatus: result.previous.verificationStatus ?? null },
        newValue: { verificationStatus: parsed.data.status, note: parsed.data.note ?? null },
      });
      return reply.send({ user: await container.users.decorate(result.current) });
    } catch (error) {
      if (error instanceof NotYourStaffError) return reply.code(403).send({ error: "not_your_staff", message: error.message });
      throw error;
    }
  });

  // ----------------------------------------------------------------- audit

  app.get<{ Querystring: Record<string, string | undefined> }>("/v1/admin/audit", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    let entries = await container.audit.list({
      resource: req.query.resource, resourceId: req.query.resourceId, actor: req.query.actor,
      action: req.query.action, from: req.query.from, to: req.query.to,
    });
    // The filters the requirements ask for, over the entries the store returned.
    if (req.query.role) entries = entries.filter((e) => e.role === req.query.role);
    if (req.query.q) {
      const needle = req.query.q.toLowerCase();
      entries = entries.filter((e) =>
        (e.resourceId ?? "").toLowerCase().includes(needle) ||
        (e.actorName ?? "").toLowerCase().includes(needle) ||
        e.actor.toLowerCase().includes(needle) ||
        e.action.toLowerCase().includes(needle));
    }
    const page = paginate(entries, req.query);
    return reply.send({
      entries: page.items,
      page: { total: page.total, limit: page.limit, offset: page.offset, hasMore: page.hasMore },
    });
  });

  // ---------------------------------------------------------------- config

  app.get("/v1/admin/config", async (req, reply) => {
    if (!(await admin(req, reply))) return;
    return reply.send({ config: await container.systemConfig.get(), defaultGarmentCategories: DEFAULT_GARMENT_CATEGORIES, defaultGarmentServices: DEFAULT_GARMENT_SERVICES });
  });

  // A garment service is added, edited and retired on its own rather than by
  // resending the whole catalogue, so introducing Starch and Press cannot drop an
  // existing service by omission.
  app.post("/v1/admin/config/services", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    try {
      const result = await container.systemConfig.addService(parsed.data, session.userId);
      await container.audit.record({ session, action: "garment_service.created", resource: "garment_service", resourceId: result.service.id, previousValue: null, newValue: result.service });
      return reply.code(201).send({ service: result.service, config: result.current });
    } catch (error) {
      if (error instanceof DuplicateServiceError) return reply.code(409).send({ error: "service_exists", message: error.message });
      if (error instanceof InvalidServiceError) return reply.code(400).send({ error: "invalid_service", message: error.message });
      throw error;
    }
  });

  app.patch("/v1/admin/config/services/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = servicePatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    const { id } = req.params as { id: string };
    const result = await container.systemConfig.updateService(id, parsed.data, session.userId);
    if (!result) return reply.code(404).send({ error: "not_found" });
    await container.audit.record({ session, action: "garment_service.changed", resource: "garment_service", resourceId: id, previousValue: result.previous.garmentServices.find((s) => s.id === id) ?? null, newValue: result.service });
    return reply.send({ service: result.service, config: result.current });
  });

  // Retiring rather than deleting, because orders already in flight reference it.
  app.delete("/v1/admin/config/services/:id", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const { id } = req.params as { id: string };
    try {
      const result = await container.systemConfig.retireService(id, session.userId);
      if (!result) return reply.code(404).send({ error: "not_found" });
      await container.audit.record({ session, action: "garment_service.retired", resource: "garment_service", resourceId: id, previousValue: result.previous.garmentServices.find((s) => s.id === id) ?? null, newValue: result.current.garmentServices.find((s) => s.id === id) ?? null });
      return reply.send({ config: result.current });
    } catch (error) {
      if (error instanceof InvalidServiceError) return reply.code(409).send({ error: "invalid_service", message: error.message });
      throw error;
    }
  });

  app.patch("/v1/admin/config", async (req, reply) => {
    const session = await admin(req, reply); if (!session) return;
    const parsed = configSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    // A bulk catalogue update may come from an older client that knows nothing about
    // per garment prices or processing flags; fill those in rather than reject it.
    const { garmentServices, ...rest } = parsed.data;
    const patch: Partial<Omit<SystemConfig, "id">> = garmentServices
      ? { ...rest, garmentServices: garmentServices.map(normaliseService) }
      : rest;
    const result = await container.systemConfig.update(patch, session.userId);
    await container.audit.record({ session, action: "system_config.changed", resource: "system_config", resourceId: result.current.id, previousValue: result.previous, newValue: result.current });
    return reply.send({ config: result.current });
  });
}
