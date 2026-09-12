import { z } from "zod";
import {
  type RealtimeTranscriptionCredential,
  type RealtimeTranscriptionGateway,
} from "../../application/ports/realtime-transcription.js";

const SINGLE_USE_TOKEN_URL =
  "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";
const TOKEN_LIFETIME_SECONDS = 15 * 60;
const TokenResponseSchema = z.object({
  token: z.string().min(16).max(4_096),
}).passthrough();

export class RealtimeTranscriptionUnavailableError extends Error {
  constructor() {
    super("Realtime transcription is unavailable");
    this.name = "RealtimeTranscriptionUnavailableError";
  }
}

export class ElevenLabsRealtimeTranscriptionGateway
implements RealtimeTranscriptionGateway {
  readonly #apiKey: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: {
    apiKey: string | undefined;
    timeoutMs: number;
    fetchImpl?: typeof fetch;
  }) {
    this.#apiKey = options.apiKey;
    this.#timeoutMs = options.timeoutMs;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async createSingleUseToken(
    signal?: AbortSignal,
  ): Promise<RealtimeTranscriptionCredential> {
    if (!this.#apiKey) throw new RealtimeTranscriptionUnavailableError();

    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await this.#fetch(SINGLE_USE_TOKEN_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "xi-api-key": this.#apiKey,
        },
        signal: requestSignal,
      });
      if (!response.ok) throw new RealtimeTranscriptionUnavailableError();

      const parsed = TokenResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new RealtimeTranscriptionUnavailableError();

      return {
        token: parsed.data.token,
        expiresInSeconds: TOKEN_LIFETIME_SECONDS,
      };
    } catch (error) {
      if (error instanceof RealtimeTranscriptionUnavailableError) throw error;
      throw new RealtimeTranscriptionUnavailableError();
    }
  }
}
