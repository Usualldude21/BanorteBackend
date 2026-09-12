import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import {
  createSupabaseSessionWithAccessToken,
  getSupabaseAccessTokenWithPassword,
} from "../config/supabase.js";
import { requestCredentials } from "../agent/cli/interactive-credentials.js";
import { createAgentRuntime } from "../agent/cli/agent-runtime.js";

const AUDIO_CHUNK_BYTES = 3_200;
const FINAL_TRANSCRIPT_TIMEOUT_MS = 8_000;

const RealtimeSessionSchema = z.object({
  version: z.literal("1"),
  token: z.string().min(16),
  expiresInSeconds: z.number().int().positive(),
  config: z.object({
    modelId: z.literal("scribe_v2_realtime"),
    languageCode: z.string().min(2).max(3),
    commitStrategy: z.enum(["manual", "vad"]),
    vadSilenceThresholdSecs: z.number().min(0.3).max(3),
    vadThreshold: z.number().min(0.1).max(0.9),
    minSpeechDurationMs: z.number().int().min(50).max(2_000),
    minSilenceDurationMs: z.number().int().min(50).max(2_000),
    includeTimestamps: z.boolean(),
    manualAudio: z.object({
      audioFormat: z.literal("pcm_16000"),
      sampleRate: z.literal(16_000),
    }),
  }).passthrough(),
}).strict();

type RealtimeSession = z.infer<typeof RealtimeSessionSchema>;

interface TranscriptionEvent {
  message_type?: string;
  text?: string;
  error?: string;
}

async function main(): Promise<void> {
  requireSupportedTerminal();
  stdout.write("Prueba de voz en modo de solo lectura. No puede ejecutar pagos.\n");

  const accessToken = await getSupabaseAccessTokenWithPassword(
    await requestCredentials(),
  );
  const realtimeSession = await requestRealtimeSession(accessToken);
  const transcript = await recordAndTranscribe(realtimeSession);

  if (!transcript) throw new Error("ElevenLabs no devolvió una transcripción");
  stdout.write(`\nPregunta reconocida: ${transcript}\n\nConsultando al agente...\n`);

  const supabaseSession = await createSupabaseSessionWithAccessToken(accessToken);
  const runtime = await createAgentRuntime(async () => supabaseSession);
  const requestId = randomUUID();

  try {
    const response = await runtime.orchestrator.answer(transcript, { streamId: requestId });
    stdout.write(`${response.answer}\n`);
  } finally {
    await runtime.close();
  }
}

async function requestRealtimeSession(accessToken: string): Promise<RealtimeSession> {
  const host = env.AGENT_API_HOST === "0.0.0.0" ? "127.0.0.1" : env.AGENT_API_HOST;
  const response = await fetch(
    `http://${host}:${env.AGENT_API_PORT}/api/transcription/realtime-session`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(env.ELEVENLABS_STT_TIMEOUT_MS + 2_000),
    },
  );

  if (!response.ok) {
    throw new Error(`El backend rechazó la sesión de voz con HTTP ${response.status}`);
  }
  return RealtimeSessionSchema.parse(await response.json());
}

async function recordAndTranscribe(session: RealtimeSession): Promise<string> {
  const socket = await openRealtimeSocket(buildRealtimeUrl(session));
  const committedSegments: string[] = [];
  let latestPartial = "";
  let recordingStopped = false;
  let resolveFinal: (() => void) | undefined;
  const finalReceived = new Promise<void>((resolve) => { resolveFinal = resolve; });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const parsed = parseTranscriptionEvent(event.data);
    if (!parsed) return;

    if (parsed.message_type === "partial_transcript" && parsed.text) {
      latestPartial = parsed.text.trim();
      stdout.write(`\rEscuchando: ${latestPartial.padEnd(80)}`);
    }
    if (parsed.message_type === "committed_transcript" && parsed.text?.trim()) {
      committedSegments.push(parsed.text.trim());
      latestPartial = "";
      if (recordingStopped) resolveFinal?.();
    }
    if (parsed.message_type?.includes("error") || parsed.error) {
      resolveFinal?.();
    }
  });

  const terminal = createInterface({ input: stdin, output: stdout, terminal: true });
  let recorder: ChildProcessWithoutNullStreams | undefined;
  try {
    await terminal.question("\nPresiona Enter para comenzar a grabar...");
    recorder = startRecorder(socket);
    await terminal.question("Grabando. Pregunta por tu saldo y presiona Enter para detener...\n");
    recordingStopped = true;
    const finalAudio = await stopRecorder(recorder);
    sendAudio(socket, finalAudio, true);

    await Promise.race([
      finalReceived,
      new Promise<void>((resolve) => setTimeout(resolve, FINAL_TRANSCRIPT_TIMEOUT_MS)),
    ]);
  } finally {
    terminal.close();
    if (recorder && recorder.exitCode === null) recorder.kill("SIGINT");
    socket.close();
  }

  return committedSegments.join(" ").trim() || latestPartial;
}

function startRecorder(socket: WebSocket): ChildProcessWithoutNullStreams {
  const recorder = spawn("arecord", [
    "-q",
    "-t", "raw",
    "-f", "S16_LE",
    "-r", "16000",
    "-c", "1",
  ]);

  let buffered = Buffer.alloc(0);
  let pending = Buffer.alloc(0);
  recorder.stdout.on("data", (data: Buffer) => {
    buffered = Buffer.concat([buffered, data]);
    while (buffered.length >= AUDIO_CHUNK_BYTES) {
      const next = buffered.subarray(0, AUDIO_CHUNK_BYTES);
      buffered = buffered.subarray(AUDIO_CHUNK_BYTES);
      if (pending.length > 0) sendAudio(socket, pending, false);
      pending = Buffer.from(next);
    }
  });
  recorder.once("error", () => {
    buffered = Buffer.alloc(0);
    pending = Buffer.alloc(0);
  });
  recorder.once("close", () => {
    const finalAudio = Buffer.concat([pending, buffered]);
    recorder.emit("final-audio", finalAudio);
  });
  return recorder;
}

async function stopRecorder(recorder: ChildProcessWithoutNullStreams): Promise<Buffer> {
  if (recorder.exitCode !== null) {
    throw new Error("El grabador de audio terminó antes de capturar la pregunta");
  }
  const finalAudio = new Promise<Buffer>((resolve) => {
    recorder.once("final-audio", (audio: Buffer) => resolve(audio));
  });
  recorder.kill("SIGINT");
  await once(recorder, "close");
  const audio = await finalAudio;
  if (audio.length === 0) throw new Error("No se capturó audio del micrófono");
  return audio;
}

function sendAudio(socket: WebSocket, audio: Buffer, commit: boolean): void {
  if (socket.readyState !== WebSocket.OPEN || audio.length === 0) return;
  socket.send(JSON.stringify({
    message_type: "input_audio_chunk",
    audio_base_64: audio.toString("base64"),
    ...(commit ? { commit: true } : {}),
  }));
}

function buildRealtimeUrl(session: RealtimeSession): string {
  const { config } = session;
  const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
  url.searchParams.set("token", session.token);
  url.searchParams.set("model_id", config.modelId);
  url.searchParams.set("audio_format", config.manualAudio.audioFormat);
  url.searchParams.set("language_code", config.languageCode);
  url.searchParams.set("commit_strategy", config.commitStrategy);
  url.searchParams.set("vad_silence_threshold_secs", String(config.vadSilenceThresholdSecs));
  url.searchParams.set("vad_threshold", String(config.vadThreshold));
  url.searchParams.set("min_speech_duration_ms", String(config.minSpeechDurationMs));
  url.searchParams.set("min_silence_duration_ms", String(config.minSilenceDurationMs));
  url.searchParams.set("include_timestamps", String(config.includeTimestamps));
  return url.toString();
}

async function openRealtimeSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("ElevenLabs no abrió la conexión a tiempo")),
      env.ELEVENLABS_STT_TIMEOUT_MS,
    );
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("No fue posible conectar con ElevenLabs"));
    }, { once: true });
  });
  return socket;
}

function parseTranscriptionEvent(value: string): TranscriptionEvent | undefined {
  try {
    return JSON.parse(value) as TranscriptionEvent;
  } catch {
    return undefined;
  }
}

function requireSupportedTerminal(): void {
  if (typeof WebSocket !== "function") {
    throw new Error("Esta prueba requiere Node.js 22 o posterior");
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("La prueba de voz requiere una terminal interactiva");
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";
  process.stderr.write(`\nNo fue posible completar la prueba de voz: ${message}\n`);
  process.exitCode = 1;
});
