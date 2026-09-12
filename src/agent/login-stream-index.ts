import { createSupabaseSessionWithPassword } from "../config/supabase.js";
import { requestCredentials } from "./cli/interactive-credentials.js";
import { handleAgentCliError } from "./cli/run-agent-cli.js";
import { runAgentStreamCli } from "./cli/run-agent-stream-cli.js";

runAgentStreamCli(async () => createSupabaseSessionWithPassword(
  await requestCredentials(),
)).catch(handleAgentCliError);
