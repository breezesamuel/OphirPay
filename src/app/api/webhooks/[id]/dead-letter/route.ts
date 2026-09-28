// SPDX-License-Identifier: MIT

import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-session";
import prisma from "@/lib/prisma";
import { successResponse, unauthorizedError, notFoundError, handleApiError } from "@/lib/api-response";

export const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const auth = await getAuthContext(request);
    if (!auth) return unauthorizedError("Authentication required.");

    const { id } = await params;

    // Verify webhook ownership
    const webhook = await prisma.webhook.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!webhook) return notFoundError("Webhook not found");
    if (webhook.userId !== auth.userId) return unauthorizedError("Forbidden");

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const resolved = searchParams.get("resolved");
    const skip = (page - 1) * limit;

    const where: any = { webhookId: id };
    if (resolved === "true") where.resolvedAt = { not: null };
    else if (resolved === "false") where.resolvedAt = null;

    const [items, total] = await Promise.all([
      prisma.webhookDeadLetter.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.webhookDeadLetter.count({ where }),
    ]);

    return successResponse({
      items: items.map((dl) => ({
        id: dl.id,
        eventType: dl.eventType,
        targetUrl: dl.targetUrl,
        errorMessage: dl.errorMessage,
        attempts: dl.attempts,
        lastStatusCode: dl.lastStatusCode,
        lastError: dl.lastError,
        createdAt: dl.createdAt,
        resolvedAt: dl.resolvedAt,
        resolution: dl.resolution,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    return handleApiError(err, "GET /api/webhooks/[id]/dead-letter");
  }
};