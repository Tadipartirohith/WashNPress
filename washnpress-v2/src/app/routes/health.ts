import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { requireRole } from "../guards";
import { productionProblems } from "../../config/production-readiness";

// A probe has to answer inside the orchestrator's own timeout — three seconds in the
// Dockerfile HEALTHCHECK — and a Postgres that has gone away does not refuse the
// connection, it waits: storage.postgres.connectionTimeoutMs is five. Without a bound
// of our own the orchestrator sees an ambiguous timeout rather than an explicit
// "not ready", and a timed-out probe and an unreachable database are the same fact.
const PROBE_TIMEOUT_MS = 2_000;

async function reachable(probe: () => Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, container: Container): void {
  // Readiness, not a heartbeat. This used to answer {status:"ok"} unconditionally,
  // which meant a deployment whose database was unreachable — nobody able to log in,
  // every request failing — still told the orchestrator it was healthy and stayed in
  // the load balancer. An assertion that cannot fail is not a health check.
  //
  // Still unauthenticated, and still says nothing about how the deployment is put
  // together: the environment name and the storage driver were deliberately taken out
  // of here because they described the deployment to an anonymous caller. What goes
  // back is booleans and a count — never which settings are wrong, which would be a
  // list of where to attack. The detail goes to the boot log and to
  // /v1/admin/diagnostics, both of which have somebody accountable behind them.
  app.get("/health", async (_req, reply) => {
    const [database, cache] = await Promise.all([
      // The narrowest read either store offers. There is no ping on the DataStore
      // port, and a primary key lookup of the one row seeding guarantees exists is
      // cheaper than anything that scans. A missing row still proves the connection,
      // so only a thrown error or the timeout counts as unreachable.
      reachable(() => container.store.societies.get(container.seedIds.societyId)),
      // Likewise the only method RateLimitStore has. The limit is set far above
      // anything a probe could reach so the check can never rate limit itself out,
      // and the key is its own so it cannot spend a real caller's budget.
      reachable(() => container.rateLimit.hit("health:probe", 1_000_000, 60_000)),
    ]);
    const configProblems = productionProblems(container.config).length;
    const ok = database && cache && configProblems === 0;
    return reply
      .code(ok ? 200 : 503)
      .send({ status: ok ? "ok" : "degraded", checks: { database, cache, configProblems } });
  });

  // The same detail, for somebody who is allowed to see it.
  app.get("/v1/admin/diagnostics", async (req, reply) => {
    const session = await requireRole(req, reply, container, "admin"); if (!session) return;
    return reply.send({
      status: "ok",
      env: container.config.app.env,
      storage: container.config.storage.driver,
      time: new Date().toISOString(),
    });
  });
}
