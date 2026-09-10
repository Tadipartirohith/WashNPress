import type { AppConfig } from "../../config";
import { HttpMessageProvider, type NotificationProvider } from "./providers";

type Logger = { info: (obj: unknown, msg?: string) => void };

// The name the code is announced under. It is part of the text an Indian operator
// registers against a DLT template, so changing it means re-registering.
const OTP_SENDER_NAME = "Wash N Press";

// Where a login code actually goes.
//
// `OtpService.send` used to generate a code, put it in a Map and return. It called
// nothing. In development the code came back in the response body so it looked like
// it worked; in production the code is withheld from the response and no gateway was
// ever called, so the code existed only inside the server and nobody could log in.
// This is the seam that was missing: the service hands the code to a sender, and the
// sender either delivers it or says plainly that it did not.
export interface OtpSender {
  send(phone: string, code: string, ttlSeconds: number): Promise<void>;
}

// MOCK. Used whenever no SMS gateway is configured, which is the default and is the
// state this deployment is in today.
//
// It logs the code at info level so a developer can log in without credentials. That
// is also why it must never be what production runs: it writes a live login code to
// the application log, where anyone with log access can use it. Configuring
// `notifications.sms.*` replaces it — see `createOtpSender` below.
export class LoggingOtpSender implements OtpSender {
  public readonly sent: { phone: string; code: string }[] = [];
  constructor(private readonly log: Logger = console) {}
  async send(phone: string, code: string, ttlSeconds: number): Promise<void> {
    this.sent.push({ phone, code });
    this.log.info(
      { phone, code, ttlSeconds },
      "no SMS gateway is configured, so this login code was logged instead of sent",
    );
  }
}

// Hands the code to a notification provider on the SMS channel.
//
// The provider is the same generic HTTP gateway the rest of the platform sends on,
// so there is one place credentials live and one payload shape to adapt to a vendor.
// A gateway that rejects the message throws, and the throw travels back to the caller
// rather than being swallowed — a login that was not delivered has to read as a
// failure, because a resident staring at a phone that never buzzes is the one thing
// worse than an error.
export class NotificationOtpSender implements OtpSender {
  constructor(private readonly provider: NotificationProvider, private readonly senderName: string) {}
  async send(phone: string, code: string, ttlSeconds: number): Promise<void> {
    const minutes = Math.max(1, Math.round(ttlSeconds / 60));
    await this.provider.send({
      channel: "sms",
      to: phone,
      title: this.senderName,
      body: `${code} is your login code. It is valid for ${minutes} minute${minutes === 1 ? "" : "s"}. Do not share it.`,
    });
  }
}

// Picks the sender from configuration.
//
// TO GO LIVE, set all four of these and the mock drops out on the next boot:
//   notifications.sms.enabled    WNP_NOTIFICATIONS__SMS__ENABLED=true
//   notifications.sms.baseUrl    WNP_NOTIFICATIONS__SMS__BASEURL=<gateway POST endpoint>
//   notifications.sms.apiKey     WNP_NOTIFICATIONS__SMS__APIKEY=<bearer token>
//   notifications.sms.sender     WNP_NOTIFICATIONS__SMS__SENDER=<approved sender id>
// and, for an Indian operator, the DLT registration the code text is registered
// against, without which the message is accepted and then dropped:
//   notifications.sms.templateId WNP_NOTIFICATIONS__SMS__TEMPLATEID=<19 digit id>
//
// The gateway contract assumed here is the one `HttpMessageProvider` already
// implements: POST to `baseUrl` with `authorization: Bearer <apiKey>` and a JSON body
// of { from, to, text, templateId? }, and any non-2xx counts as not sent. A vendor
// that wants a different shape is a change to that one provider, not to this file.
//
// The composite router is deliberately not used for the code. It falls back to a
// recorder for a channel it has no credentials for, and a recorder returns success —
// which would put us straight back where we started, with a login the server
// believes it sent.
export function createOtpSender(config: AppConfig, log: Logger = console): OtpSender {
  const sms = config.notifications.sms;
  if (!sms.enabled || !sms.baseUrl || !sms.apiKey) return new LoggingOtpSender(log);
  return new NotificationOtpSender(
    new HttpMessageProvider(sms.baseUrl, sms.apiKey, sms.sender, sms.templateId),
    OTP_SENDER_NAME,
  );
}
