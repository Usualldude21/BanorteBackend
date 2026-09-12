import { stdout } from "node:process";
import { getSupabaseAccessTokenWithPassword } from "../config/supabase.js";
import { requestCredentials } from "./cli/interactive-credentials.js";
import { handleAgentCliError } from "./cli/run-agent-cli.js";

async function main(): Promise<void> {
  const accessToken = await getSupabaseAccessTokenWithPassword(
    await requestCredentials(),
  );
  stdout.write(`\nJWT de Supabase (temporal):\n${accessToken}\n`);
}

main().catch(handleAgentCliError);
