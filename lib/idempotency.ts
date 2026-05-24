import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";

import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type HandlerResult<T> = {
  body: T;
  status: number;
};

function isUniqueConstraint(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runIdempotently<T>(
  request: NextRequest,
  path: string,
  handler: () => Promise<HandlerResult<T>>,
): Promise<HandlerResult<unknown>> {
  const key = request.headers.get("Idempotency-Key")?.trim();

  if (!key) {
    return handler();
  }

  const method = request.method.toUpperCase();

  try {
    await prisma.idempotencyRecord.create({
      data: { key, method, path },
    });
  } catch (error) {
    if (!isUniqueConstraint(error)) {
      throw error;
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const existing = await prisma.idempotencyRecord.findUnique({
        where: { key_method_path: { key, method, path } },
      });

      if (existing && existing.statusCode !== 0) {
        return { body: existing.response, status: existing.statusCode };
      }

      await sleep(100);
    }

    throw new ApiError(409, "A request with this Idempotency-Key is still in progress.", "IDEMPOTENCY_IN_PROGRESS");
  }

  try {
    const result = await handler();
    await prisma.idempotencyRecord.update({
      where: { key_method_path: { key, method, path } },
      data: {
        statusCode: result.status,
        response: result.body as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      const body = { error: error.message, code: error.code };
      await prisma.idempotencyRecord.update({
        where: { key_method_path: { key, method, path } },
        data: {
          statusCode: error.status,
          response: body,
          completedAt: new Date(),
        },
      });
      return { body, status: error.status };
    }

    throw error;
  }
}
