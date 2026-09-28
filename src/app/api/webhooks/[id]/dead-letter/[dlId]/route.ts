// SPDX-License-Identifier: MIT

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { successResponse, unauthorizedError, notFoundError, handleApiError } from "@/lib/api-response";

export const PATCH = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string; dlId: string }> }
) => {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id, dlId } = await params;
    const body = await request.json();
    const { resolution } = body as { resolution: "discarded" | "ignored" };

    if (!["discarded", "ignored"].includes(resolution)) {
      return NextResponse.json({ error: "Invalid resolution" }, { status: 400 });
    }

    // Verify webhook ownership
    const webhook = await prisma.webhook.findUnique({
      where: { id },
      select: { id: true, userId: true },
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

    await prisma.webhookDeadLetter.update({
      where: { id: dlId },
      data: {
        resolvedAt: new Date(),
        resolvedBy: auth.userId,
        resolution,
      },
    });

    return successResponse({ resolved: true, resolution });
  } catch (err) {
    return handleApiError(err, "PATCH /api/webhooks/[id]/dead-letter/[dlId]");
  }
};