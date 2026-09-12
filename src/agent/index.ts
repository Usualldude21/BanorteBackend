import { createAuthenticatedSupabaseSession } from "../config/supabase.js";
import { handleAgentCliError, runAgentCli } from "./cli/run-agent-cli.js";

runAgentCli(createAuthenticatedSupabaseSession).catch(handleAgentCliError);
