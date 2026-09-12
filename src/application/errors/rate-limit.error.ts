export class RateLimitError extends Error {
  constructor(readonly retryAfterMs = 0) {
    super("Se alcanzó el límite de solicitudes");
    this.name = "RateLimitError";
  }
}
