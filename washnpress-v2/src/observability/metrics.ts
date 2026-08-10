// A tiny in process metrics registry that renders Prometheus text. It avoids a heavy
// dependency while still giving a real /metrics endpoint that a Prometheus server or
// the OpenTelemetry collector can scrape.
type Labels = Record<string, string>;

class Registry {
  private counters = new Map<string, number>();

  private serialiseLabels(labels: Labels): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return "";
    return "{" + keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, "'")}"`).join(",") + "}";
  }

  inc(name: string, labels: Labels = {}, value = 1): void {
    const key = name + this.serialiseLabels(labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  render(): string {
    const lines: string[] = [];
    const seen = new Set<string>();
    for (const key of this.counters.keys()) {
      const name = key.split("{")[0];
      if (!seen.has(name)) { lines.push(`# TYPE ${name} counter`); seen.add(name); }
      lines.push(`${key} ${this.counters.get(key)}`);
    }
    return lines.join("\n") + "\n";
  }
}

export const metrics = new Registry();
