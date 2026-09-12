import { type SupabaseClient } from "@supabase/supabase-js";
import { type BeneficiaryReader } from "../application/ports/payment.js";
import { BeneficiarySchema, type Beneficiary } from "../domain/beneficiary.js";
import { mapearErrorSupabase, RepositoryError } from "../errors/repository.error.js";
import { telemetry } from "../observability/telemetry.js";

const RESULT_LIMIT = 100;

export class BeneficiaryRepository implements BeneficiaryReader {
  constructor(private readonly client: SupabaseClient) {}

  async listActiveByUser(userId: string): Promise<Beneficiary[]> {
    const { data } = await telemetry.observe(
      { component: "supabase", operation: "query", queryName: "beneficiaries.list-active" },
      async () => {
        const result = await this.client
          .from("beneficiaries")
          .select("id,user_id,name,institution,account_type,masked_account,currency,status,created_at,updated_at")
          .eq("user_id", userId)
          .eq("status", "active")
          .order("name", { ascending: true })
          .range(0, RESULT_LIMIT);
        if (result.error) throw mapearErrorSupabase(result.error, "beneficiaries.list-active");
        return result;
      },
      (result) => ({ resultCount: result.data?.length ?? 0 }),
    );

    if (!Array.isArray(data)) {
      throw new RepositoryError("Respuesta inválida al consultar beneficiarios", "DATABASE_ERROR");
    }
    if (data.length > RESULT_LIMIT) {
      throw new RepositoryError("La consulta supera el límite de beneficiarios", "INVALID_INPUT");
    }
    return data.map((row) => {
      const result = BeneficiarySchema.safeParse(row);
      if (!result.success) {
        throw new RepositoryError("Datos de beneficiario inválidos", "DATABASE_ERROR", result.error);
      }
      return result.data;
    });
  }
}
