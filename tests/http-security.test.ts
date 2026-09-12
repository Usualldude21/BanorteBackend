import assert from "node:assert/strict";
import { type AddressInfo } from "node:net";
import test from "node:test";
import { createSystemApi } from "../src/http/system-api.js";

const ALLOWED_ORIGIN = "http://localhost:5173";

test("la API aplica cabeceras de seguridad a sus respuestas", async (context) => {
  const api = createSystemApi({ allowedOrigins: [ALLOWED_ORIGIN] });
  context.after(() => api.close());
  const baseUrl = await listen(api);

  const response = await fetch(`${baseUrl}/api/system/status`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(response.headers.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
});

test("CORS refleja solamente un origen incluido en la allowlist", async (context) => {
  const api = createSystemApi({ allowedOrigins: [ALLOWED_ORIGIN] });
  context.after(() => api.close());
  const baseUrl = await listen(api);

  const allowed = await fetch(`${baseUrl}/api/system/status`, {
    headers: { Origin: ALLOWED_ORIGIN },
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
  assert.equal(allowed.headers.get("vary"), "Origin");

  const denied = await fetch(`${baseUrl}/api/system/status`, {
    headers: { Origin: "https://evil.example" },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("el preflight permite únicamente métodos y cabeceras esperados", async (context) => {
  const api = createSystemApi({ allowedOrigins: [ALLOWED_ORIGIN] });
  context.after(() => api.close());
  const baseUrl = await listen(api);

  const accepted = await fetch(`${baseUrl}/api/agent`, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get("access-control-allow-methods"), "POST");
  assert.match(accepted.headers.get("access-control-allow-headers") ?? "", /authorization/);
  assert.equal(
    accepted.headers.get("vary"),
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  );

  const denied = await fetch(`${baseUrl}/api/agent`, {
    method: "OPTIONS",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-unsafe-header",
    },
  });
  assert.equal(denied.status, 403);
});

test("una ruta existente rechaza métodos no permitidos antes de autenticar", async (context) => {
  let authenticationCalls = 0;
  const api = createSystemApi({
    allowedOrigins: [ALLOWED_ORIGIN],
    createUserSession: async () => {
      authenticationCalls += 1;
      throw new Error("no debe autenticarse");
    },
  });
  context.after(() => api.close());
  const baseUrl = await listen(api);

  const response = await fetch(`${baseUrl}/api/agent`, { method: "GET" });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
  assert.equal(authenticationCalls, 0);
});

async function listen(api: ReturnType<typeof createSystemApi>): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    api.once("error", reject);
    api.listen(0, "127.0.0.1", resolve);
  });
  const address = api.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}
