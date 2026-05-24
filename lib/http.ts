import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export function json<T>(body: T, status = 200) {
  return NextResponse.json(body, { status });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.message, code: error.code }, error.status);
  }

  if (error instanceof ZodError) {
    return json(
      {
        error: "The request body is invalid.",
        code: "VALIDATION_ERROR",
        issues: error.flatten(),
      },
      400,
    );
  }

  console.error(error);
  return json({ error: "Unexpected server error.", code: "INTERNAL_ERROR" }, 500);
}
