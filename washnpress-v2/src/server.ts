import { loadConfig } from "./config";
import { buildContainer } from "./container";
import { buildApp } from "./app/build-app";

async function main(): Promise<void> {
  const config = loadConfig();
  const container = await buildContainer(config);
  const app = buildApp(container);

  // Background worker: drain the notification outbox on an interval so delivery is
  // decoupled from the request path. In production this can run as a separate process.
  const workerMs = 5000;
  const worker = setInterval(() => {
    container.notifications.processOutboxOnce().catch((err) => app.log.error(err, "outbox worker failed"));
  }, workerMs);
  worker.unref();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    clearInterval(worker);
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
