import "@tanstack/react-start/server-only";

export type BoundedJsonRequestResult =
  | { status: "ok"; value: unknown }
  | {
      status: "error";
      responseStatus: 400 | 413 | 415;
      error: "invalid_json" | "invalid_content_type" | "payload_too_large";
    };

export async function readBoundedJsonRequest(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonRequestResult> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return {
      status: "error",
      responseStatus: 415,
      error: "invalid_content_type",
    };
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    return {
      status: "error",
      responseStatus: 413,
      error: "payload_too_large",
    };
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maximumBytes)
    return {
      status: "error",
      responseStatus: 413,
      error: "payload_too_large",
    };
  try {
    return { status: "ok", value: JSON.parse(rawBody) as unknown };
  } catch {
    return { status: "error", responseStatus: 400, error: "invalid_json" };
  }
}
