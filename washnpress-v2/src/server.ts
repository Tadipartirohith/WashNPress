import { loadConfig } from "./config";
import { buildContainer } from "./container";
import { buildApp } from "./app/build-app";
import { JobRunner } from "./jobs/job-runner";
import { initTracing } from "./observability/tracing";

async function main(): Promise<void> {
  const config = loadConfig();
  const container = await buildContainer(config);
  const app = buildApp(container);

  initTracing(config, app.log);

  const jobs = new JobRunner(
    config,
    { notifications: container.notifications, reconciliation: container.reconciliation, recurring: container.recurring },
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
