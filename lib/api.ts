import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

export type ApiPayload = Record<string, unknown> | unknown[];

export type ApiResult = {
  status: number;
  body: ApiPayload;
};

type TxClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type DbClient = PrismaClient | TxClient;

export function json(result: ApiResult) {
  return NextResponse.json(result.body, { status: result.status });
}

export function error(status: number, message: string, details?: unknown): ApiResult {
  return {
    status,
    body: {
      error: message,
      ...(details ? { details } : {}),
    },
  };
}

export function getIdempotencyKey(request: NextRequest) {
  const value = request.headers.get("Idempotency-Key");
  return value?.trim() || null;
}

export function hashBody(body: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(body ?? null))
    .digest("hex");
}

export async function withIdempotency(
  prisma: PrismaClient,
  request: NextRequest,
  scope: string,
  body: unknown,
  handler: (tx: TxClient) => Promise<ApiResult>,
) {
  const key = getIdempotencyKey(request);

  if (!key) {
    return json(
      await transactionWithRetry(prisma, (tx) => handler(tx)),
    );
  }

  const bodyHash = hashBody(body);
  const path = request.nextUrl.pathname;

  const result = await transactionWithRetry(
    prisma,
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))`;

      const existing = await tx.idempotencyRecord.findUnique({
        where: { key_scope: { key, scope } },
      });

      if (existing) {
        if (existing.bodyHash !== bodyHash) {
          return error(
            409,
            "Idempotency-Key was already used with a different request body.",
          );
        }

        return {
          status: existing.statusCode,
          body: existing.response as ApiPayload,
        };
      }

      const next = await handler(tx);
      await tx.idempotencyRecord.create({
        data: {
          key,
          scope,
          method: request.method,
          path,
          bodyHash,
          statusCode: next.status,
          response: next.body as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      return next;
    },
  );

  return json(result);
}

async function transactionWithRetry<T>(
  prisma: PrismaClient,
  callback: (tx: TxClient) => Promise<T>,
) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (cause) {
      if (attempt === maxAttempts || !isRetryableTransactionError(cause)) {
        throw cause;
      }
    }
  }

  throw new Error("Transaction retry loop exhausted.");
}

function isRetryableTransactionError(cause: unknown) {
  return (
    cause instanceof Prisma.PrismaClientKnownRequestError &&
    cause.code === "P2034"
  );
}

export async function parseJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
