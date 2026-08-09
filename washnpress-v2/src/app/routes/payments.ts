import type { FastifyInstance } from "fastify";
import type { Container } from "../../container";
import { InvalidSignatureError } from "../../services/payment-service";

export function registerPaymentRoutes(app: FastifyInstance, container: Container): void {
  const header = container.config.payments.webhookSignatureHeader;

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
