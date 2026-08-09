import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Container } from "../../container";
import { requireRole } from "../guards";

const slotSchema = z.object({ societyId: z.string(), date: z.string(), window: z.string(), startTime: z.string(), endTime: z.string(), capacityTotal: z.number().int().positive() });

export function registerAdminRoutes(app: FastifyInstance, container: Container): void {
  app.get("/v1/admin/reports/subscriptions", async (req, reply) => { if (!(await requireRole(req, reply, container, "admin"))) return; return reply.send(await container.reports.subscriptions()); });
  app.get("/v1/admin/reports/revenue", async (req, reply) => { if (!(await requireRole(req, reply, container, "admin"))) return; return reply.send(await container.reports.revenue()); });
  app.get("/v1/admin/reports/operations", async (req, reply) => { if (!(await requireRole(req, reply, container, "admin"))) return; return reply.send(await container.reports.operations()); });
  app.get("/v1/admin/reports/sustainability", async (req, reply) => { if (!(await requireRole(req, reply, container, "admin"))) return; return reply.send(await container.reports.sustainability()); });
  app.get("/v1/admin/reports/garment-risk", async (req, reply) => { if (!(await requireRole(req, reply, container, "admin"))) return; return reply.send(await container.reports.garmentRisk()); });

  app.post("/v1/admin/slots", async (req, reply) => {
    if (!(await requireRole(req, reply, container, "admin"))) return;
    const parsed = slotSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request" });
    const { randomUUID } = await import("node:crypto");
    const slot = await container.store.slots.put({ id: randomUUID(), ...parsed.data, capacityRemaining: parsed.data.capacityTotal, isActive: true });
    return reply.code(201).send({ slot });
  });
}
