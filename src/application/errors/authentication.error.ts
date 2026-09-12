export class AuthenticationError extends Error {
  constructor(message: string, readonly originalError?: unknown) {
    super(message);
    this.name = "AuthenticationError";
  }
}
