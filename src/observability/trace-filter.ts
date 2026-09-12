const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export function filterTraceLine(line: string, requestId: string): string | null {
  if (!REQUEST_ID_PATTERN.test(requestId)) throw new InvalidTraceRequestError();
  try {
    const value = JSON.parse(line) as unknown;
    return hasRequestId(value, requestId) ? line : null;
  } catch {
    return null;
  }
}

function hasRequestId(value: unknown, requestId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const metadata = (value as Record<string, unknown>).metadata;
  return Boolean(
    metadata
    && typeof metadata === "object"
    && (metadata as Record<string, unknown>).requestId === requestId,
  );
}

export class InvalidTraceRequestError extends Error {
  constructor() {
    super("El requestId no tiene un formato válido");
    this.name = "InvalidTraceRequestError";
  }
}
