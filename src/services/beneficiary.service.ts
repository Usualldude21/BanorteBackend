import { type AuthenticatedUser } from "../application/authenticated-user.js";
import { type BeneficiaryReader } from "../application/ports/payment.js";
import {
  GetBeneficiariesOutputSchema,
  type GetBeneficiariesOutput,
} from "../schemas/beneficiary.schema.js";

export class BeneficiaryService {
  constructor(
    private readonly repository: BeneficiaryReader,
    private readonly user: AuthenticatedUser,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listActive(): Promise<GetBeneficiariesOutput> {
    const beneficiaries = await this.repository.listActiveByUser(this.user.id);
    return GetBeneficiariesOutputSchema.parse({
      beneficiaries: beneficiaries.map((beneficiary) => ({
        id: beneficiary.id,
        name: beneficiary.name,
        institution: beneficiary.institution,
        accountType: beneficiary.account_type,
        maskedAccount: beneficiary.masked_account,
        currency: beneficiary.currency,
        status: beneficiary.status,
      })),
      metadata: {
        totalBeneficiaries: beneficiaries.length,
        queriedAt: this.now().toISOString(),
      },
    });
  }
}
