// SPDX-License-Identifier: MIT

import prisma from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { logger } from "@/lib/logger";
import type { WebhookEventType } from "@/app/api/webhooks/event-types";
import {
  recordWebhookDelivery,
  storeWebhookEvent,
} from "@/lib/webhook-event-store";
import { isSubscribedToEvent } from "@/lib/webhook-filter";

/**
 * Dispatch a webhook event to subscribed endpoints.
 */
export async function dispatchWebhookEvent(
  event: WebhookEventType,
  data: Record<string, unknown>,
  scopedUserId?: string,
): Promise<void> {
  if (typeof window !== "undefined") return;

  try {
    const activeWebhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        ...(scopedUserId ? { userId: scopedUserId } : {}),
      },
    });
    const webhooks = activeWebhooks.filter(
      (wh: Awaited<ReturnType<typeof prisma.webhook.findMany>>[number]) =>
        isSubscribedToEvent(wh.events, event),
    );
    if (webhooks.length === 0) return;

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    logger.info("Dispatching webhooks", { event, count: webhooks.length });

    let storedEventId: string | null = null;
    if (scopedUserId) {
      storedEventId = await storeWebhookEvent(
        scopedUserId,
        event,
        data,
        payload.timestamp,
      );
    }

    // Fire all webhook deliveries in parallel (non-blocking)
    const results = await Promise.allSettled(
      webhooks.map(async (wh) => {
        const result = await deliverWebhook(wh.url, wh.secret, payload, 3, wh.id);
        if (storedEventId) {
          await recordWebhookDelivery(wh.id, storedEventId, result.success ? "SUCCESS" : "FAILED", {
            responseCode: result.statusCode,
            latencyMs: result.latencyMs,
            attempts: result.attempts,
            errorMessage: result.errorMessage,
          });
        }
      })
    );

    results.forEach((r, i) => {
      if (r.status === "rejected") {
        logger.error("Webhook dispatch error", { webhookId: webhooks[i].id, error: r.reason });
      }
    });
  } catch (err) {
    logger.error("dispatchWebhookEvent failed", { error: err instanceof Error ? err.message : String(err) });
  }
}