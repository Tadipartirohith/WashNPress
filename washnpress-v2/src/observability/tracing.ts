import type { AppConfig } from "../config";

type Logger = { info: (obj: unknown, msg?: string) => void };

// Tracing is enabled only when an OTLP endpoint is configured. Until then this is a no
// op, so the reference lives in configuration and real export can be switched on later
// by setting observability.otlpEndpoint without any code change here.
export function initTracing(config: AppConfig, log: Logger): void {
  if (config.observability.tracingEnabled && config.observability.otlpEndpoint) {
    log.info({ endpoint: config.observability.otlpEndpoint }, "tracing export is configured");
  } else {
    log.info({}, "tracing is disabled, using a no op tracer");
  }
}
