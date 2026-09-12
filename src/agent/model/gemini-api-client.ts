import {
  GeminiResponseSchema,
  type GeminiContent,
  type GeminiResponse,
} from "../schemas/gemini.schema.js";
import { telemetry, type Telemetry } from "../../observability/telemetry.js";
import { logger } from "../../config/logger.js";

export interface GeminiModelConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export type FetchImplementation = typeof fetch;
const MAX_PROVIDER_ATTEMPTS = 2;
const RETRY_DELAY_MS = 750;

export class GeminiApiClient {
  constructor(
    private readonly config: GeminiModelConfig,
    private readonly fetchImplementation: FetchImplementation = fetch,
    private readonly instrumentation: Telemetry = telemetry,
  ) {}

  async generateContent(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<GeminiContent> {
    const result = await this.instrumentation.observe(
      { component: "llm", operation: "gemini.generate-content" },
      async () => {
        const response = await requestGeminiWithRetry({
          url: buildGenerateContentUrl(this.config.apiUrl, this.config.model),
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.config.apiKey,
            },
            body: JSON.stringify(body),
          },
          timeoutMs: this.config.timeoutMs,
          fetchImplementation: this.fetchImplementation,
          ...(signal ? { signal } : {}),
        });

        if (!response.ok) {
          logger.warn("Gemini rechazó la solicitud", { statusCode: response.status });
          throw new GeminiModelError(`Gemini respondió con estado HTTP ${response.status}`);
        }

        const parsed = GeminiResponseSchema.safeParse(await readJson(response));
        if (!parsed.success) {
          throw new GeminiModelError("Gemini devolvió una respuesta con formato inválido");
        }
        return parsed.data;
      },
      tokenSummary,
    );

    return result.candidates[0]!.content;
  }
}

interface GeminiRequestOptions {
  url: string;
  init: RequestInit;
  timeoutMs: number;
  fetchImplementation: FetchImplementation;
  signal?: AbortSignal;
}

async function requestGeminiWithRetry(options: GeminiRequestOptions): Promise<Response> {
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    const response = await fetchWithTimeout(
      options.url,
      options.init,
      options.timeoutMs,
      options.fetchImplementation,
      options.signal,
    );
    if (!isRetryableStatus(response.status) || attempt === MAX_PROVIDER_ATTEMPTS) return response;
    logger.warn("Gemini no está disponible; reintentando", {
      statusCode: response.status,
      retryNumber: attempt,
    });
    await waitForRetry(RETRY_DELAY_MS * attempt, options.signal);
  }
  throw new GeminiModelError("Gemini no pudo completar la solicitud");
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function waitForRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new GeminiModelError("La solicitud fue cancelada"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timeout);
      reject(new GeminiModelError("La solicitud fue cancelada"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function tokenSummary(response: GeminiResponse) {
  const usage = response.usageMetadata;
  return {
    ...(usage?.promptTokenCount === undefined ? {} : { inputTokens: usage.promptTokenCount }),
    ...(usage?.candidatesTokenCount === undefined
      ? {}
      : { outputTokens: usage.candidatesTokenCount }),
    ...(usage?.totalTokenCount === undefined ? {} : { totalTokens: usage.totalTokenCount }),
    ...(usage?.cachedContentTokenCount === undefined
      ? {}
      : { cachedTokens: usage.cachedContentTokenCount }),
    ...(usage?.thoughtsTokenCount === undefined
      ? {}
      : { thinkingTokens: usage.thoughtsTokenCount }),
  };
}

export class GeminiModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiModelError";
  }
}

export function buildGenerateContentUrl(apiUrl: string, model: string): string {
  const url = new URL(apiUrl);
  const basePath = url.pathname.replace(/\/$/, "");
  const apiPath = basePath.endsWith("/v1beta") ? basePath : `${basePath}/v1beta`;
  url.pathname = `${apiPath}/models/${encodeURIComponent(model)}:generateContent`;
  return url.toString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new GeminiModelError("Gemini devolvió una respuesta con formato inválido");
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: FetchImplementation,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const abortRequest = () => controller.abort();
  externalSignal?.addEventListener("abort", abortRequest, { once: true });
  if (externalSignal?.aborted) controller.abort();

  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } catch {
    if (didTimeout) {
      throw new GeminiModelError("La solicitud a Gemini excedió el tiempo límite");
    }
    if (externalSignal?.aborted) throw new GeminiModelError("La solicitud fue cancelada");
    throw new GeminiModelError("No fue posible comunicarse con Gemini");
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortRequest);
  }
}
