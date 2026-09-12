import assert from "node:assert/strict";
import { once } from "node:events";
import { type AddressInfo } from "node:net";
import test from "node:test";
import { createRealtimeTranscriptionSessionService } from "../src/application/create-realtime-transcription-session.js";
import { ElevenLabsRealtimeTranscriptionGateway } from "../src/infrastructure/elevenlabs/elevenlabs-realtime-transcription.js";
import { type AuthenticatedSupabaseSession } from "../src/config/supabase.js";
import { createSystemApi } from "../src/http/system-api.js";

test("ElevenLabs solicita un token efímero sin exponer la API key", async () => {
  let receivedUrl = "";
  let receivedApiKey = "";
  const gateway = new ElevenLabsRealtimeTranscriptionGateway({
    apiKey: "private-elevenlabs-key",
    timeoutMs: 1_000,
    fetchImpl: (async (input, init) => {
      receivedUrl = String(input);
      receivedApiKey = new Headers(init?.headers).get("xi-api-key") ?? "";
      return new Response(JSON.stringify({ token: "sutkn_test_1234567890" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });

  const result = await gateway.createSingleUseToken();
  assert.equal(receivedUrl, "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe");
  assert.equal(receivedApiKey, "private-elevenlabs-key");
  assert.deepEqual(result, {
    token: "sutkn_test_1234567890",
    expiresInSeconds: 900,
  });
});

test("ElevenLabs falla de forma cerrada ante credenciales o respuestas inválidas", async () => {
  const missingKey = new ElevenLabsRealtimeTranscriptionGateway({
    apiKey: undefined,
    timeoutMs: 1_000,
  });
  await assert.rejects(() => missingKey.createSingleUseToken());

  const rejectedRequest = new ElevenLabsRealtimeTranscriptionGateway({
    apiKey: "private-elevenlabs-key",
    timeoutMs: 1_000,
    fetchImpl: (async () => new Response(
      JSON.stringify({ detail: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch,
  });
  await assert.rejects(() => rejectedRequest.createSingleUseToken());
});

test("el endpoint realtime exige JWT y entrega configuración compatible con frontend", async () => {
  let calls = 0;
  const realtimeTranscription = createRealtimeTranscriptionSessionService({
    gateway: {
      async createSingleUseToken() {
        calls += 1;
        return { token: "sutkn_test_1234567890", expiresInSeconds: 900 };
      },
    },
    settings: {
      modelId: "scribe_v2_realtime",
      languageCode: "es",
      commitStrategy: "vad",
      vadSilenceThresholdSecs: 1,
      vadThreshold: 0.4,
      minSpeechDurationMs: 100,
      minSilenceDurationMs: 100,
      includeTimestamps: false,
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      manualAudio: {
        audioFormat: "pcm_16000",
        sampleRate: 16_000,
      },
    },
  });
  const server = createSystemApi({
    realtimeTranscription,
    createUserSession: async () => ({
      user: { id: "10000000-0000-4000-8000-000000000001" },
      client: {},
    } as unknown as AuthenticatedSupabaseSession),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/transcription/realtime-session`;

  try {
    const unauthorized = await fetch(url, { method: "POST" });
    assert.equal(unauthorized.status, 401);
    assert.equal(calls, 0);

    const authorized = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer individual-user-access-token-long-enough" },
    });
    assert.equal(authorized.status, 200);
    const body = await authorized.json() as Record<string, unknown>;
    assert.equal(body.token, "sutkn_test_1234567890");
    assert.deepEqual(body.config, {
      modelId: "scribe_v2_realtime",
      languageCode: "es",
      commitStrategy: "vad",
      vadSilenceThresholdSecs: 1,
      vadThreshold: 0.4,
      minSpeechDurationMs: 100,
      minSilenceDurationMs: 100,
      includeTimestamps: false,
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      manualAudio: {
        audioFormat: "pcm_16000",
        sampleRate: 16_000,
      },
    });
    assert.equal(calls, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
