import { z } from "zod";

const EnvSchema = z.object({
  MCP_SERVER_NAME: z.string().min(1).default("agent-mcp-server"),
  MCP_SERVER_VERSION: z.string().min(1).default("0.1.0"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(60),
  MCP_WRITE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(100).default(6),

  SUPABASE_URL: z.string().url("SUPABASE_URL debe ser una URL válida").optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_ACCESS_TOKEN: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(20).optional(),
  ),

  GEMINI_API_URL: z
    .string()
    .url("GEMINI_API_URL debe ser una URL válida")
    .refine(isTrustedGeminiUrl, "GEMINI_API_URL debe usar HTTPS y el host oficial de Gemini")
    .optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,100}$/, "GEMINI_MODEL contiene caracteres inválidos")
    .default("gemini-3.7-flash"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(60_000),
  ELEVENLABS_API_KEY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().trim().min(16).max(512).optional(),
  ),
  ELEVENLABS_STT_MODEL: z.literal("scribe_v2_realtime").default("scribe_v2_realtime"),
  ELEVENLABS_STT_LANGUAGE: z.string()
    .regex(/^[a-z]{2,3}$/, "ELEVENLABS_STT_LANGUAGE debe ser un código ISO-639")
    .default("es"),
  ELEVENLABS_STT_COMMIT_STRATEGY: z.enum(["manual", "vad"]).default("vad"),
  ELEVENLABS_STT_VAD_SILENCE_SECONDS: z.coerce.number().min(0.3).max(3).default(1),
  ELEVENLABS_STT_VAD_THRESHOLD: z.coerce.number().min(0.1).max(0.9).default(0.4),
  ELEVENLABS_STT_MIN_SPEECH_MS: z.coerce.number().int().min(50).max(2_000).default(100),
  ELEVENLABS_STT_MIN_SILENCE_MS: z.coerce.number().int().min(50).max(2_000).default(100),
  ELEVENLABS_STT_INCLUDE_TIMESTAMPS: z.enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  ELEVENLABS_STT_ECHO_CANCELLATION: z.enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ELEVENLABS_STT_NOISE_SUPPRESSION: z.enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ELEVENLABS_STT_AUTO_GAIN_CONTROL: z.enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ELEVENLABS_STT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
  AGENT_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(20).default(6),
  AGENT_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(12_000),
  AGENT_TOOL_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  AGENT_RETRY_DELAY_MS: z.coerce.number().int().min(0).max(2_000).default(200),
  AGENT_API_HOST: z.string().ip({ version: "v4" }).default("127.0.0.1"),
  AGENT_API_PORT: z.coerce.number().int().min(1_024).max(65_535).default(3_101),
  AGENT_API_ALLOWED_ORIGINS: z.preprocess(
    splitCommaSeparatedValue,
    z.array(z.string().refine(isHttpOrigin, "Cada origen CORS debe ser un origen HTTP(S) válido"))
      .default([]),
  ).transform((origins) => [...new Set(origins.map((origin) => new URL(origin).origin))]),
  AGENT_AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(60),
  AGENT_API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(20),
  AGENT_API_TOKEN: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(32).max(512).optional(),
  ),
});

export type Env = z.infer<typeof EnvSchema>;

function cargarEntorno(): Env {
  const resultado = EnvSchema.safeParse(process.env);

  if (!resultado.success) {
    console.error(
      "[config] Variables de entorno inválidas:",
      resultado.error.flatten().fieldErrors,
    );
    process.exit(1);
  }

  return resultado.data;
}

export const env: Env = cargarEntorno();

function isTrustedGeminiUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:"
    && url.hostname === "generativelanguage.googleapis.com"
    && !url.username
    && !url.password
    && !url.search
    && !url.hash;
}

function splitCommaSeparatedValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function isHttpOrigin(value: string): boolean {
  if (value === "*") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && url.origin === value.replace(/\/$/, "")
      && url.pathname === "/"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}
