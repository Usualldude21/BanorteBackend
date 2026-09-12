import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationError } from "../src/application/errors/authentication.error.js";
import { authenticateUser } from "../src/config/supabase.js";
import { createLogger } from "../src/config/logger.js";

test("authenticateUser obtiene la identidad validada desde el JWT", async () => {
  const token = "jwt-sintetico-no-se-registra";
  let receivedToken: string | undefined;
  const client = {
    auth: {
      getUser: async (accessToken: string) => {
        receivedToken = accessToken;
        return {
          data: { user: { id: "10000000-0000-4000-8000-000000000001" } },
          error: null,
        };
      },
    },
  } as Parameters<typeof authenticateUser>[0];

  const user = await authenticateUser(client, token);

  assert.equal(receivedToken, token);
  assert.deepEqual(user, { id: "10000000-0000-4000-8000-000000000001" });
});

test("authenticateUser falla de forma segura ante una identidad inválida", async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "usuario-no-valido" } }, error: null }),
    },
  } as unknown as Parameters<typeof authenticateUser>[0];

  await assert.rejects(
    authenticateUser(client, "jwt-sintetico-no-se-registra"),
    AuthenticationError,
  );
});

test("el logger redacta secretos, identidad y datos financieros", () => {
  const lines: string[] = [];
  const logger = createLogger({
    level: "debug",
    write: (line) => lines.push(line),
    now: () => new Date("2026-09-12T00:00:00.000Z"),
  });

  logger.info("prueba de redacción", {
    token: "token-privado",
    password: "contraseña-privada",
    userId: "10000000-0000-4000-8000-000000000001",
    accounts: [{ balance: "22500.00" }],
    resultCount: 3,
  });

  const entry = JSON.parse(lines[0] ?? "null") as {
    metadata?: Record<string, unknown>;
  };
  assert.deepEqual(entry.metadata, {
    token: "[redacted]",
    password: "[redacted]",
    userId: "[redacted]",
    accounts: "[redacted]",
    resultCount: 3,
  });
  assert.equal(lines[0]?.includes("token-privado"), false);
  assert.equal(lines[0]?.includes("contraseña-privada"), false);
  assert.equal(lines[0]?.includes("22500.00"), false);
});
