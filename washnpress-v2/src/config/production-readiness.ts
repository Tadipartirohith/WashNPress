import type { AppConfig } from "./schema";

// What is wrong with a deployment that calls itself production.
//
// Every default in config/default.json is chosen so that a developer with nothing
// installed can clone the repository and have a working system: storage in memory,
// notification providers mocked, a payment gateway that agrees to everything, a
// webhook secret written down in the repository, CORS open to any origin. Each of
// those is right locally and each of them is a different kind of outage or breach
// once the same file is what a real deployment boots from — and until now nothing
// looked. A deployment could come up, pass its health check, take real bookings and
// lose them all on the first restart.
//
// This is a pure function of the configuration so it can be asserted in a test
// rather than reasoned about, and so /health can ask it on every probe without
// touching anything.

// The secret shipped in config/default.json. It is in the repository, in the image,
// and in the smoke test script, so treating it as configured is the same as having
// no signature check at all.
const PLACEHOLDER_WEBHOOK_SECRET = "change-me-in-config-local-or-env";

export function productionProblems(config: AppConfig): string[] {
  // Everything below describes a machine serving real residents. Development, test
  // and staging are meant to run on mocks; complaining there would train people to
  // ignore the complaint.
  if (config.app.env !== "production") return [];

  const problems: string[] = [];

  if (config.storage.driver === "memory") {
    problems.push(
      "storage.driver is \"memory\": every order, payment, account and ledger entry lives in the process and is gone on the next restart or redeploy. " +
      "Set DATABASE_URL to the Postgres connection string (which now selects the driver too), or set WNP_STORAGE__DRIVER=postgres explicitly.",
    );
  }

  const sms = config.notifications.sms;
  if (!sms.enabled || sms.provider === "mock") {
    problems.push(
      "notifications.sms is not a real gateway (enabled=" + String(sms.enabled) + ", provider=\"" + sms.provider + "\"): the login OTP is generated and never delivered, so no resident and no member of staff can sign in at all. " +
      "Set WNP_NOTIFICATIONS__SMS__ENABLED=true with WNP_NOTIFICATIONS__SMS__PROVIDER, __BASEURL, __APIKEY, __SENDER and the DLT __TEMPLATEID.",
    );
  }

  // The container falls back to FakePaymentProvider whenever the Razorpay credentials
  // are missing, and the fake reports every order paid. That failure is silent and it
  // is the expensive direction: goods leave the building against money that never moved.
  if (config.payments.provider === "razorpay" && (!config.payments.keyId || !config.payments.keySecret)) {
    problems.push(
      "payments.provider is \"razorpay\" but keyId or keySecret is empty, so the container falls back to the fake provider, which marks every order paid without any money moving. " +
      "Set WNP_PAYMENTS__KEYID and WNP_PAYMENTS__KEYSECRET, or set payments.provider to something that is meant to be free.",
    );
  }

  if (!config.payments.webhookSecret || config.payments.webhookSecret === PLACEHOLDER_WEBHOOK_SECRET) {
    problems.push(
      "payments.webhookSecret is empty or still the placeholder shipped in config/default.json: anyone who has read this repository can sign a payment webhook and credit any wallet with any amount. " +
      "Set RAZORPAY_WEBHOOK_SECRET to the secret configured in the gateway dashboard.",
    );
  }

  if (config.app.corsOrigins.includes("*")) {
    problems.push(
      "app.corsOrigins contains \"*\": any page a logged-in resident happens to open can call this API from their browser. " +
      "Set WNP_APP__CORSORIGINS to a comma separated list of the origins the apps are actually served from.",
    );
  }

  return problems;
}

type Logger = { error: (obj: unknown, msg?: string) => void };

// Called once from the server entrypoint, straight after loadConfig() and before the
// container is built — before anything opens a port or accepts a booking.
//
// It throws rather than calling process.exit(1) for two reasons: a module that can
// kill the process cannot be exercised from a test without taking the test runner
// with it, and the entrypoint already owns how the process dies. The problems are
// logged one line at a time first, because a container platform shows the last few
// log lines and a five-problem stack trace is where they go to be ignored.
export function assertProductionReadiness(config: AppConfig, log: Logger): void {
  const problems = productionProblems(config);
  if (problems.length === 0) return;
  for (const problem of problems) log.error({ problem }, "production configuration is not deployable");
  throw new Error(
    `Refusing to start: ${problems.length} production configuration problem(s).\n` +
    problems.map((p) => `  - ${p}`).join("\n"),
  );
}
