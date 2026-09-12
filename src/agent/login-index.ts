import { createSupabaseSessionWithPassword } from "../config/supabase.js";
import { requestCredentials } from "./cli/interactive-credentials.js";
import { handleAgentCliError, runAgentCli } from "./cli/run-agent-cli.js";

runAgentCli(async () => createSupabaseSessionWithPassword(
  await requestCredentials(),
)).catch(handleAgentCliError);
