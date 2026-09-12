import { createAuthenticatedSupabaseSession } from "../config/supabase.js";
import { handleAgentCliError } from "./cli/run-agent-cli.js";
import { runAgentStreamCli } from "./cli/run-agent-stream-cli.js";

runAgentStreamCli(createAuthenticatedSupabaseSession).catch(handleAgentCliError);
