import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AuthenticationError } from "../application/errors/authentication.error.js";
import { type AuthenticatedUser } from "../application/authenticated-user.js";
import { env } from "./env.js";
import { z } from "zod";

const REQUEST_TIMEOUT_MS = 10_000;
const UserIdSchema = z.string().uuid();
const AccessTokenSchema = z.string().min(20);
const PasswordCredentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(6).max(1_024),
}).strict();

export interface AuthenticatedSupabaseSession {
  client: SupabaseClient;
  user: AuthenticatedUser;
}

interface SupabaseSessionConfig {
  url?: string | undefined;
  publishableKey?: string | undefined;
  accessToken?: string | undefined;
}

interface SupabaseProjectConfig {
  url?: string | undefined;
  publishableKey?: string | undefined;
}

export interface PasswordCredentials {
  email: string;
  password: string;
}

export async function createAuthenticatedSupabaseSession(
  config: SupabaseSessionConfig = {
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    accessToken: env.SUPABASE_ACCESS_TOKEN,
  },
): Promise<AuthenticatedSupabaseSession> {
  const { url, publishableKey, accessToken } = requireSessionConfig(config);
  return createSupabaseSessionWithAccessToken(accessToken, { url, publishableKey });
}

export async function createSupabaseSessionWithAccessToken(
  accessToken: string,
  config: SupabaseProjectConfig = {
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  },
): Promise<AuthenticatedSupabaseSession> {
  const { url, publishableKey } = requireProjectConfig(config);
  const validatedAccessToken = AccessTokenSchema.safeParse(accessToken);
  if (!validatedAccessToken.success) {
    throw new AuthenticationError("El access token de Supabase no es válido");
  }
  const authClient = createClient(url, publishableKey, clientOptions());
  const user = await authenticateUser(authClient, validatedAccessToken.data);

  return createDataSession(url, publishableKey, validatedAccessToken.data, user);
}

export async function createSupabaseSessionWithPassword(
  credentials: PasswordCredentials,
  config: SupabaseProjectConfig = {
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  },
): Promise<AuthenticatedSupabaseSession> {
  const { url, publishableKey } = requireProjectConfig(config);
  const authClient = createClient(url, publishableKey, clientOptions());
  const authentication = await authenticateWithPassword(authClient, credentials);
  return createDataSession(
    url,
    publishableKey,
    authentication.accessToken,
    authentication.user,
  );
}

export async function getSupabaseAccessTokenWithPassword(
  credentials: PasswordCredentials,
  config: SupabaseProjectConfig = {
    url: env.SUPABASE_URL,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
  },
): Promise<string> {
  const { url, publishableKey } = requireProjectConfig(config);
  const authClient = createClient(url, publishableKey, clientOptions());
  const authentication = await authenticateWithPassword(authClient, credentials);
  return authentication.accessToken;
}

export async function authenticateWithPassword(
  client: Pick<SupabaseClient, "auth">,
  credentials: PasswordCredentials,
): Promise<{ accessToken: string; user: AuthenticatedUser }> {
  const validatedCredentials = PasswordCredentialsSchema.parse(credentials);
  const { data, error } = await client.auth.signInWithPassword(validatedCredentials);
  const accessToken = AccessTokenSchema.safeParse(data.session?.access_token);

  if (error || !accessToken.success) {
    throw new AuthenticationError("No se pudo iniciar sesión en Supabase", error);
  }

  const user = await authenticateUser(client, accessToken.data);
  return { accessToken: accessToken.data, user };
}

function createDataSession(
  url: string,
  publishableKey: string,
  accessToken: string,
  user: AuthenticatedUser,
): AuthenticatedSupabaseSession {
  const client = createClient(url, publishableKey, {
    ...clientOptions(),
    accessToken: async () => accessToken,
  });

  return { client, user };
}

export async function authenticateUser(
  client: Pick<SupabaseClient, "auth">,
  accessToken: string,
): Promise<AuthenticatedUser> {
  const { data, error } = await client.auth.getUser(accessToken);
  const userId = UserIdSchema.safeParse(data.user?.id);
  if (error || !userId.success) {
    throw new AuthenticationError("No se pudo autenticar la sesión de Supabase", error);
  }

  return { id: userId.data };
}

function requireSessionConfig(config: SupabaseSessionConfig) {
  const project = requireProjectConfig(config);
  if (!config.accessToken) {
    throw new AuthenticationError(
      "SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY y SUPABASE_ACCESS_TOKEN son obligatorias",
    );
  }
  return {
    ...project,
    accessToken: config.accessToken,
  };
}

function requireProjectConfig(config: SupabaseProjectConfig) {
  if (!config.url || !config.publishableKey) {
    throw new AuthenticationError(
      "SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY son obligatorias",
    );
  }
  return { url: config.url, publishableKey: config.publishableKey };
}

function clientOptions() {
  const realtimeTransport = globalThis.WebSocket ?? DisabledRealtimeTransport;
  return {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { timeout: REQUEST_TIMEOUT_MS },
    realtime: { transport: realtimeTransport },
    global: { fetch: fetchWithTimeout },
  };
}

class DisabledRealtimeTransport {
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readonly readyState = this.CLOSED;
  readonly url: string;
  readonly protocol = "";
  onopen: ((event: Event) => unknown) | null = null;
  onmessage: ((event: MessageEvent) => unknown) | null = null;
  onclose: ((event: CloseEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;

  constructor(address: string | URL) {
    this.url = String(address);
    throw new Error("Realtime no está habilitado en este backend");
  }

  close(): void {}
  send(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
