import { type AnomalyTransaction } from "../domain/anomaly.js";
import { type AnomalyTransactionReader } from "../application/ports/financial-data.js";
import { type DetectAnomaliesInput, type DetectAnomaliesOutput } from "../schemas/detect-anomalies.schema.js";
import { type AuthenticatedUser } from "../application/authenticated-user.js";

type AnomalyOutputItem = DetectAnomaliesOutput["anomalies"][number];
type ScoredAnomaly = AnomalyOutputItem & { scoreUnits: bigint };

interface DetectionResult {
  anomalies: ScoredAnomaly[];
  eligibleGroups: number;
}

export class AnomalyService {
  constructor(
    private readonly repository: AnomalyTransactionReader,
    private readonly user: AuthenticatedUser,
  ) {}

  async detectar(input: DetectAnomaliesInput): Promise<DetectAnomaliesOutput> {
    const transactions = await this.repository.obtenerMuestra({
      ...input,
      userId: this.user.id,
    });
    const detection = detectIqrAnomalies(transactions, input.minSampleSize);

    return {
      anomalies: detection.anomalies.slice(0, input.limit).map(({ scoreUnits: _, ...anomaly }) => anomaly),
      metadata: {
        queriedAt: new Date().toISOString(),
        startDate: input.startDate,
        endDate: input.endDate,
        filters: {
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.transactionType ? { transactionType: input.transactionType } : {}),
          ...(input.currency ? { currency: input.currency } : {}),
        },
        evaluatedTransactions: transactions.length,
        eligibleGroups: detection.eligibleGroups,
        method: "iqr",
        minSampleSize: input.minSampleSize,
      },
    };
  }
}

export function detectIqrAnomalies(
  transactions: AnomalyTransaction[],
  minSampleSize: number,
): DetectionResult {
  const groups = groupComparableTransactions(transactions);
  const eligibleGroups = [...groups.values()].filter((group) => group.length >= minSampleSize);
  const anomalies = eligibleGroups.flatMap(detectGroupAnomalies);

  anomalies.sort((left, right) => {
    if (left.scoreUnits !== right.scoreUnits) return left.scoreUnits > right.scoreUnits ? -1 : 1;
    const byDate = right.transactionDate.localeCompare(left.transactionDate);
    return byDate || right.transactionId.localeCompare(left.transactionId);
  });

  return { anomalies, eligibleGroups: eligibleGroups.length };
}

function groupComparableTransactions(
  transactions: AnomalyTransaction[],
): Map<string, AnomalyTransaction[]> {
  const groups = new Map<string, AnomalyTransaction[]>();

  for (const transaction of transactions) {
    const key = JSON.stringify([transaction.currency, transaction.type, transaction.category]);
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }

  return groups;
}

function detectGroupAnomalies(group: AnomalyTransaction[]): ScoredAnomaly[] {
  const amounts = group.map((transaction) => toMinorUnits(transaction.amount)).sort(compareBigInt);
  const firstQuartile = percentileDiscrete(amounts, 0.25);
  const thirdQuartile = percentileDiscrete(amounts, 0.75);
  const interquartileRange = thirdQuartile - firstQuartile;
  const margin = divideRoundUp(interquartileRange * 3n, 2n);
  const lower = maxBigInt(0n, firstQuartile - margin);
  const upper = thirdQuartile + margin;
  const normalizationBase = interquartileRange > 0n
    ? interquartileRange
    : maxBigInt(thirdQuartile, 1n);

  return group.flatMap((transaction) => {
    const amount = toMinorUnits(transaction.amount);
    if (amount >= lower && amount <= upper) return [];

    const distance = amount > upper ? amount - upper : lower - amount;
    const scoreUnits = divideRoundHalfUp(distance * 10_000n, normalizationBase);

    return [{
      transactionId: transaction.id,
      amount: transaction.amount,
      currency: transaction.currency,
      category: transaction.category,
      transactionType: transaction.type,
      transactionDate: transaction.transaction_date,
      expectedRange: { lower: formatMinorUnits(lower), upper: formatMinorUnits(upper) },
      anomalyScore: formatFixed(scoreUnits, 4),
      classification: "statistical_anomaly" as const,
      reason: amount > upper
        ? "amount_above_expected_range" as const
        : "amount_below_expected_range" as const,
      scoreUnits,
    }];
  });
}

function percentileDiscrete(values: bigint[], percentile: number): bigint {
  const index = Math.floor((values.length - 1) * percentile);
  const value = values[index];
  if (value === undefined) throw new Error("No se puede calcular un percentil sin datos");
  return value;
}

function toMinorUnits(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount);
  if (!match) throw new Error("Importe monetario inválido");
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function formatMinorUnits(value: bigint): string {
  return formatFixed(value, 2);
}

function formatFixed(value: bigint, decimals: number): string {
  const digits = value.toString().padStart(decimals + 1, "0");
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function compareBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
