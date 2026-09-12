import assert from "node:assert/strict";
import test from "node:test";
import { mapearErrorSupabase } from "../src/errors/repository.error.js";
import { classifyRepositoryError } from "../src/application/tool-error-result.js";

test("L11 distingue saldo insuficiente de otros errores P0001 sin filtrar detalles SQL", () => {
  const insufficient = mapearErrorSupabase({ code: "P0001", message: "insufficient funds", details: null, hint: null }, "create_payment_intent");
  assert.equal(insufficient.code, "INSUFFICIENT_FUNDS");
  assert.deepEqual(classifyRepositoryError(insufficient.code), { code: "insufficient_funds", retryable: false });
  const other = mapearErrorSupabase({ code: "P0001", message: "currency mismatch", details: null, hint: null }, "create_payment_intent");
  assert.equal(other.code, "INVALID_INPUT");
});
