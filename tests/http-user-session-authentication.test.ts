import assert from "node:assert/strict";
import test from "node:test";
import { type AuthenticatedSupabaseSession } from "../src/config/supabase.js";
import { createAuthenticatedRequestSessionFactory } from "../src/http/system-api.js";

const legacyApiToken = "agent-api-token-with-at-least-thirty-two-characters";
const userAccessToken = "supabase-user-access-token-with-sufficient-length";

test("la API exige y propaga la identidad Supabase individual por petición", async () => {
  const receivedTokens: string[] = [];
  const createUserSession = async (accessToken: string) => {
    receivedTokens.push(accessToken);
    if (accessToken === "invalid-supabase-access-token") throw new Error("invalid token");
    return {
      client: {} as AuthenticatedSupabaseSession["client"],
      user: {
        id: accessToken === userAccessToken
          ? "10000000-0000-4000-8000-000000000001"
          : "10000000-0000-4000-8000-000000000002",
      },
    };
  };

  assert.equal(await authenticate({}, createUserSession), undefined);
  assert.equal(receivedTokens.length, 0);

  assert.equal(await authenticate({ authorization: `Bearer ${legacyApiToken}` }, createUserSession), undefined);
  assert.equal(receivedTokens.length, 0);

  const firstFactory = await authenticate(
    { authorization: `Bearer ${userAccessToken}` },
    createUserSession,
  );
  assert.equal((await firstFactory!()).user.id, "10000000-0000-4000-8000-000000000001");
  assert.deepEqual(receivedTokens, [userAccessToken]);

  const secondUserToken = "second-supabase-user-access-token-with-sufficient-length";
  const secondFactory = await authenticate({
    authorization: `Bearer ${legacyApiToken}`,
    "x-supabase-access-token": secondUserToken,
  }, createUserSession);
  assert.equal((await secondFactory!()).user.id, "10000000-0000-4000-8000-000000000002");
  assert.deepEqual(receivedTokens, [userAccessToken, secondUserToken]);

  assert.equal(await authenticate(
    { authorization: "Bearer invalid-supabase-access-token" },
    createUserSession,
  ), undefined);
});

function authenticate(
  headers: Record<string, string>,
  createUserSession: (accessToken: string) => Promise<AuthenticatedSupabaseSession>,
) {
  return createAuthenticatedRequestSessionFactory(
    { headers },
    legacyApiToken,
    createUserSession,
  );
}
