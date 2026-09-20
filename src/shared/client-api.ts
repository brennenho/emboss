"use client";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-Emboss-Request": "1",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      0,
      "OFFLINE",
      "Connection failed. Check your network and retry. Your edits are still here.",
    );
  }
  if (!response.ok) {
    let error: {
      code: string;
      message: string;
      fields?: Record<string, string>;
    };
    try {
      const data = (await response.json()) as { error: typeof error };
      error = data.error;
    } catch {
      throw new ApiError(
        response.status,
        "UNAVAILABLE",
        "The request failed. Try again.",
      );
    }
    throw new ApiError(
      response.status,
      error.code,
      error.message,
      error.fields,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
