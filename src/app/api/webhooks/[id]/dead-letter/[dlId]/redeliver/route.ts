// SPDX-License-Identifier: MIT

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { deliverWebhook } from "@/lib/webhook-deliver";
import { successResponse, unauthorizedError, notFoundError, handleApiError } from "@/lib/api-response";

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dlId: string }> }
) => {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id, dlId } = await params;

    // Verify webhook ownership
    const webhook = await prisma.webhook.findUnique({
      where: { id },
      select: { id: true, userId: true, url: true, secret: true },
    });
    if (!webhook) return notFoundError("Webhook not found");
    if (webhook.userId !== auth.userId) return unauthorizedError("Forbidden");

    // Find dead-letter entry
    const deadLetter = await prisma.webhookDeadLetter.findUnique({
      where: { id: dlId, webhookId: id },
    });
    if (!deadLetter) return notFoundError("Dead-letter entry not found");
    if (deadLetter.resolvedAt) {
      return NextResponse.json({ error: "Already resolved" }, { status: 400 });
    }

    // Reconstruct payload
    const payload = JSON.parse(deadLetter.payload);

    // Attempt redelivery
    const result = await deliverWebhook(webhook.url, webhook.secret, payload, 3, webhook.id);

    // Update dead-letter entry
    await prisma.webhookDeadLetter.update({
      where: { id: dlId },
      data: {
        attempts: { increment: result.attempts },
        lastStatusCode: result.statusCode,
        lastError: result.errorMessage,
        responseBody: result.responseBody,
        resolvedAt: result.success ? new Date() : null,
        resolvedBy: result.success ? auth.userId : null,
        resolution: result.success ? "redelivered" : "redelivery_failed",
      },
    });

    if (result.success) {
      // Also record in webhookDelivery for dashboard
      if (deadLetter.eventId) {
        await prisma.webhookDelivery.create({
          data: {
            webhookId: webhook.id,
            eventId: deadLetter.eventId,
            status: "SUCCESS",
            responseCode: result.statusCode,
            latencyMs: result.latencyMs,
            attempts: result.attempts,
            isReplay: true,
          },
        });
      }
    }

    return successResponse({
      success: result.success,
      statusCode: result.statusCode,
      errorMessage: result.errorMessage,
      resolved: result.success,
    });
  } catch (err) {
    return handleApiError(err, "POST /api/webhooks/[id]/dead-letter/[dlId]/redeliver");
  }
};