import { loadConfig } from "./config";
import { assertProductionReadiness } from "./config/production-readiness";
import { buildContainer } from "./container";
import { buildApp } from "./app/build-app";
import { JobRunner } from "./jobs/job-runner";
import { initTracing } from "./observability/tracing";

async function main(): Promise<void> {
  const config = loadConfig();

  // Before anything is built, connected to or seeded.
  //
  // Every default in config/default.json exists so a developer can clone and run:
  // storage in memory, notifications mocked, a payment provider that calls every
  // order paid, a webhook secret committed to the repository, CORS open to all. Each
  // is correct locally and each is a different outage or breach once a real
  // deployment boots the same file, and nothing looked. A deployment could come up,
  // report healthy, take bookings and lose them on the first restart.
  //
  // The process dies here rather than serving traffic it cannot honour. Console
  // rather than the app logger on purpose: the app does not exist yet, and a
  // configuration this broken must not depend on anything to announce itself.
  assertProductionReadiness(config, {
    error: (obj: unknown, msg?: string) => console.error(msg ?? "", obj),
  });

  const container = await buildContainer(config);
  const app = buildApp(container);

  initTracing(config, app.log);

  const jobs = new JobRunner(
    config,
    { notifications: container.notifications, reconciliation: container.reconciliation, recurring: container.recurring, renewal: container.renewal },
    app.log,
  );
  jobs.start();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    jobs.stop();
    await container.shutdown();
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    await app.listen({ host: config.app.host, port: config.app.port });
    app.log.info(`Wash N Press backend live on http://${config.app.host}:${config.app.port} (storage ${config.storage.driver})`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
