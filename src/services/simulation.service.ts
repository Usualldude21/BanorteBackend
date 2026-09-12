import { getPaymentCount, PAYMENTS_PER_YEAR } from "../domain/simulation.js";
import {
  type SimulateLoanInput,
  type SimulateLoanOutput,
  type SimulateSavingsInput,
  type SimulateSavingsOutput,
} from "../schemas/simulation.schema.js";

const RATE_SCALE = 1_000_000_000_000n;

export class SimulationService {
  simulateLoan(input: SimulateLoanInput): SimulateLoanOutput {
    const principal = parseMoney(input.principal);
    const paymentCount = requirePaymentCount(input.termMonths, input.paymentFrequency);
    const periodicRate = parsePeriodicRate(
      input.annualInterestRate,
      PAYMENTS_PER_YEAR[input.paymentFrequency],
    );
    const regularPayment = calculateLoanPayment(principal, periodicRate, paymentCount);
    const amortizationSchedule = buildAmortizationSchedule(
      principal,
      periodicRate,
      paymentCount,
      regularPayment,
    );
    const totalPaid = amortizationSchedule.reduce(
      (total, payment) => total + parseMoney(payment.paymentAmount),
      0n,
    );

    return {
      dataType: "SIMULATED",
      paymentAmount: formatMoney(regularPayment),
      totalInterest: formatMoney(totalPaid - principal),
      totalPaid: formatMoney(totalPaid),
      numberOfPayments: paymentCount,
      amortizationSchedule,
    };
  }

  simulateSavings(input: SimulateSavingsInput): SimulateSavingsOutput {
    const initialAmount = parseMoney(input.initialAmount);
    const contribution = parseMoney(input.periodicContribution);
    const periodCount = requirePaymentCount(input.durationMonths, input.frequency);
    const periodicRate = parsePeriodicRate(input.annualRate, PAYMENTS_PER_YEAR[input.frequency]);
    const timeline: SimulateSavingsOutput["timeline"] = [];
    let balance = initialAmount;

    for (let period = 1; period <= periodCount; period += 1) {
      const interestEarned = multiplyRate(balance, periodicRate);
      balance += interestEarned + contribution;
      timeline.push({
        period,
        contribution: formatMoney(contribution),
        interestEarned: formatMoney(interestEarned),
        balance: formatMoney(balance),
      });
    }

    const totalContributions = initialAmount + contribution * BigInt(periodCount);
    return {
      dataType: "SIMULATED",
      projectedBalance: formatMoney(balance),
      totalContributions: formatMoney(totalContributions),
      estimatedGrowth: formatMoney(balance - totalContributions),
      numberOfPeriods: periodCount,
      timeline,
    };
  }
}

function calculateLoanPayment(
  principal: bigint,
  periodicRate: bigint,
  paymentCount: number,
): bigint {
  if (periodicRate === 0n) return divideRoundHalfUp(principal, BigInt(paymentCount));

  const growth = fixedPower(RATE_SCALE + periodicRate, paymentCount);
  return divideRoundHalfUp(
    principal * periodicRate * growth,
    RATE_SCALE * (growth - RATE_SCALE),
  );
}

function buildAmortizationSchedule(
  principal: bigint,
  periodicRate: bigint,
  paymentCount: number,
  regularPayment: bigint,
): SimulateLoanOutput["amortizationSchedule"] {
  const schedule: SimulateLoanOutput["amortizationSchedule"] = [];
  let balance = principal;

  for (let paymentNumber = 1; paymentNumber <= paymentCount; paymentNumber += 1) {
    const interestPaid = multiplyRate(balance, periodicRate);
    const paymentAmount = paymentNumber === paymentCount
      ? balance + interestPaid
      : regularPayment;
    const principalPaid = paymentAmount - interestPaid;
    balance -= principalPaid;

    schedule.push({
      paymentNumber,
      paymentAmount: formatMoney(paymentAmount),
      principalPaid: formatMoney(principalPaid),
      interestPaid: formatMoney(interestPaid),
      remainingBalance: formatMoney(balance),
    });
  }

  return schedule;
}

function parsePeriodicRate(annualRate: string, periodsPerYear: number): bigint {
  return divideRoundHalfUp(parseFixed(annualRate, 12), BigInt(periodsPerYear * 100));
}

function parseFixed(value: string, decimalPlaces: number): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer!) * 10n ** BigInt(decimalPlaces)
    + BigInt(fraction.padEnd(decimalPlaces, "0"));
}

function parseMoney(value: string): bigint {
  return parseFixed(value, 2);
}

function formatMoney(value: bigint): string {
  const digits = value.toString().padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

function multiplyRate(amount: bigint, rate: bigint): bigint {
  return divideRoundHalfUp(amount * rate, RATE_SCALE);
}

function fixedMultiply(left: bigint, right: bigint): bigint {
  return divideRoundHalfUp(left * right, RATE_SCALE);
}

function fixedPower(base: bigint, exponent: number): bigint {
  let result = RATE_SCALE;
  let factor = base;
  let remaining = exponent;

  while (remaining > 0) {
    if (remaining % 2 === 1) result = fixedMultiply(result, factor);
    factor = fixedMultiply(factor, factor);
    remaining = Math.floor(remaining / 2);
  }

  return result;
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function requirePaymentCount(durationMonths: number, frequency: keyof typeof PAYMENTS_PER_YEAR): number {
  const count = getPaymentCount(durationMonths, frequency);
  if (count === null) throw new Error("La duración no produce un número entero de pagos");
  return count;
}
