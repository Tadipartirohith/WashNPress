import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { InvalidSignatureError } from "../../services/payment-service";
import { enabledPaymentMethods, needsGateway } from "../../domain/payments/methods";

export function registerPaymentRoutes(app: FastifyInstance, container: Container): void {
  const header = container.config.payments.webhookSignatureHeader;

  // What the resident may actually pay with.
  //
  // The application asks rather than deciding, because whether UPI can be offered is
  // a fact about this deployment's gateway credentials and not something a phone can
  // know. A method switched on with no gateway key behind it is not returned at all:
  // offering it would put a resident on a payment page that cannot load.
  app.get("/v1/payments/methods", async () => {
    const p = container.config.payments;
    const methods = enabledPaymentMethods(p);
    return {
      currency: p.currency,
      methods: methods.map((method) => ({ method, needsGateway: needsGateway(method) })),
    };
  });

  app.post("/v1/payments/webhook", async (request, reply) => {
    // rawBody is captured by the content type parser registered in build-app.
    const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? "";
    const signature = request.headers[header] as string | undefined;
    try {
      const result = await container.payments.handleWebhook(rawBody, signature);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof InvalidSignatureError) {
        return reply.code(401).send({ error: "invalid_signature" });
      }
      return reply.code(400).send({ error: "invalid_webhook", message: (error as Error).message });
    }
  });
}
