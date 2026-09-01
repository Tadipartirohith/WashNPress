// Email joins the channels a message can go out on: a staff account is created
// against an address, and the address has to be proved before it is.
export interface NotificationMessage { channel: "sms" | "whatsapp" | "push" | "email"; to: string; title: string; body: string; }
export interface NotificationProvider { send(message: NotificationMessage): Promise<void>; }

// Mock provider used for local development and for any channel that is not yet
// configured. It records what would have been sent so tests and demos can inspect it.
export class LoggingNotificationProvider implements NotificationProvider {
  public readonly sent: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> { this.sent.push(message); }
}

// A generic HTTP SMS or WhatsApp gateway. The exact body shape varies by vendor, so
// this sends a simple JSON payload that most gateways accept or can be adapted to.
//
// `templateId` is the DLT registration an Indian operator checks before it will
// carry a transactional SMS. It is omitted from the payload when it is not set,
// because a gateway that does not use one should not be sent an empty field.
export class HttpMessageProvider implements NotificationProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly sender: string,
    private readonly templateId = "",
  ) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        from: this.sender, to: message.to, text: `${message.title}: ${message.body}`,
        ...(this.templateId ? { templateId: this.templateId } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Message gateway responded with status ${res.status}`);
  }
}

// WhatsApp through Meta's Cloud API.
//
// Not SMS with a different transport. A business may send free text only inside the
// twenty-four hours after the customer last wrote; outside it, the only thing that
// will be delivered is a template approved in advance, addressed by name. Both
// shapes are here because both are real: the template is what a "your order is on
// its way" message has to be, and the free text is what a reply inside a live
// conversation is.
//
// The address is a phone number id issued by Meta, not the sender's own number, and
// the numbers it is sent to have to be in international form.
export class WhatsAppCloudProvider implements NotificationProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly templateName = "",
  ) {}
  async send(message: NotificationMessage): Promise<void> {
    const body = this.templateName
      ? {
        messaging_product: "whatsapp", to: message.to, type: "template",
        template: {
          name: this.templateName,
          language: { code: "en" },
          components: [{ type: "body", parameters: [{ type: "text", text: `${message.title}: ${message.body}` }] }],
        },
      }
      : {
        messaging_product: "whatsapp", to: message.to, type: "text",
        text: { body: `${message.title}: ${message.body}` },
      };
    const res = await fetch(`${this.baseUrl}/${this.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.accessToken}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WhatsApp Cloud API responded with status ${res.status}`);
  }
}

// A generic transactional email gateway.
//
// The same shape as the message gateway above and for the same reason: every vendor
// names the fields differently, and a JSON body of from, to, subject and text is
// the part they agree on. What email does not share with SMS is the split between a
// subject and a body — a notification's title is its subject line, not the first
// few words of the sentence.
export class HttpEmailProvider implements NotificationProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fromAddress: string,
    private readonly fromName = "",
  ) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        from: this.fromName ? { email: this.fromAddress, name: this.fromName } : this.fromAddress,
        to: message.to, subject: message.title, text: message.body,
      }),
    });
    if (!res.ok) throw new Error(`Email gateway responded with status ${res.status}`);
  }
}

// Expo's push service, which is what the two applications actually register
// against.
//
// Firebase alone would only cover Android: reaching an iPhone through FCM means
// uploading an APNs authentication key to Firebase and keeping it current, which is
// a second set of credentials to hold and rotate for the same job. Expo's service
// fronts both, takes the token the app already has, and needs no server key — the
// token itself is the authorisation to send to that one device.
//
// Sending goes device by device rather than as a batch. A notification is raised
// because something happened to one person's order, so a batch would nearly always
// be a batch of one, and one failing token would be indistinguishable from all of
// them failing.
export class ExpoPushProvider implements NotificationProvider {
  constructor(private readonly baseUrl: string) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ to: message.to, title: message.title, body: message.body, sound: "default" }),
    });
    if (!res.ok) throw new Error(`Expo push responded with status ${res.status}`);
    // A 200 is not a delivery. Expo answers with a per-message ticket, and a token
    // that no longer exists comes back as an error inside that ticket — which is
    // exactly the case the caller needs to hear about, because it means the handset
    // should be stood down rather than retried.
    const payload = await res.json().catch(() => null) as { data?: { status?: string; message?: string; details?: { error?: string } } } | null;
    const ticket = payload?.data;
    if (ticket?.status === "error") {
      throw new Error(ticket.details?.error ?? ticket.message ?? "Expo push rejected the message");
    }
  }
}

// Firebase Cloud Messaging legacy HTTP provider. Sends a notification payload to a
// device token. The server key comes from configuration.
export class FcmPushProvider implements NotificationProvider {
  constructor(private readonly baseUrl: string, private readonly serverKey: string) {}
  async send(message: NotificationMessage): Promise<void> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `key=${this.serverKey}` },
      body: JSON.stringify({ to: message.to, notification: { title: message.title, body: message.body } }),
    });
    if (!res.ok) throw new Error(`FCM responded with status ${res.status}`);
  }
}
