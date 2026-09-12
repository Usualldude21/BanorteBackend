import { type FinancialCategory } from "./transaction.js";

export interface FinancialConstraints {
  revision: number;
  savingsGoal?: { amount: string; currency: "MXN" };
  horizonMonths?: number;
  monthlyContribution?: { amount: string; currency: "MXN" };
  protectedExpenseCategories: FinancialCategory[];
}

export interface FinancialConstraintUpdate {
  constraints: FinancialConstraints;
  changed: boolean;
}

const PROTECTED_CATEGORY_PATTERNS: Array<{
  category: FinancialCategory;
  pattern: RegExp;
}> = [
  { category: "housing", pattern: /\b(?:renta|hipoteca|vivienda)\b/u },
  { category: "health", pattern: /\b(?:salud|medicinas?|tratamiento)\b/u },
  { category: "education", pattern: /\b(?:educacion|colegiatura|escuela)\b/u },
  { category: "transport", pattern: /\b(?:transporte|pasajes?|gasolina)\b/u },
];

export function emptyFinancialConstraints(): FinancialConstraints {
  return { revision: 0, protectedExpenseCategories: [] };
}

export function updateFinancialConstraints(
  current: FinancialConstraints,
  prompt: string,
): FinancialConstraintUpdate {
  const normalized = normalize(prompt);
  const next: FinancialConstraints = {
    ...current,
    protectedExpenseCategories: [...current.protectedExpenseCategories],
  };
  const contribution = extractAmount(
    normalized,
    /\b(?:puedo|podria|logro|planeo)\s+(?:ahorrar|aportar)\s+\$?\s*([\d,.]+\s*k?)\s*(?:mensual(?:es)?|al mes|\/\s*mes)\b/u,
  );
  const goal = extractAmount(
    normalized,
    /\b(?:quiero|necesito|mi meta es|meta de ahorro(?: de)?)\s+(?:ahorrar|juntar|alcanzar)?\s*\$?\s*([\d,.]+\s*k?)/u,
  );
  const horizon = /\b(?:en|durante|plazo de)\s+(\d{1,3})\s+mes(?:es)?\b/u.exec(normalized);

  if (goal) next.savingsGoal = { amount: goal, currency: "MXN" };
  if (contribution) next.monthlyContribution = { amount: contribution, currency: "MXN" };
  if (horizon) {
    const months = Number(horizon[1]);
    if (months >= 1 && months <= 600) next.horizonMonths = months;
  }

  for (const { category, pattern } of PROTECTED_CATEGORY_PATTERNS) {
    if (!pattern.test(normalized)) continue;
    const canReduce = /\b(?:ya|ahora)\s+(?:si\s+)?puedo\s+(?:reducir|recortar|bajar)\b/u.test(normalized);
    const cannotReduce = /\b(?:no puedo|no quiero|no debo)\s+(?:reducir|recortar|bajar|cambiar)\b/u.test(normalized);
    if (canReduce) {
      next.protectedExpenseCategories = next.protectedExpenseCategories.filter((item) => item !== category);
    } else if (cannotReduce && !next.protectedExpenseCategories.includes(category)) {
      next.protectedExpenseCategories.push(category);
    }
  }
  next.protectedExpenseCategories.sort();

  const changed = comparable(current) !== comparable(next);
  next.revision = changed ? current.revision + 1 : current.revision;
  return { constraints: next, changed };
}

function extractAmount(value: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(value);
  if (!match?.[1]) return undefined;
  const token = match[1].replaceAll(" ", "");
  const multiplier = token.endsWith("k") ? 1_000 : 1;
  const normalized = token.replace(/k$/u, "").replaceAll(",", "");
  if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(normalized) || Number(normalized) <= 0) return undefined;
  const amount = Number(normalized) * multiplier;
  if (!Number.isSafeInteger(Math.round(amount * 100)) || amount > 999_999_999_999) return undefined;
  return amount.toFixed(2);
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-MX");
}

function comparable(value: FinancialConstraints): string {
  const { revision: _, ...content } = value;
  return JSON.stringify(content);
}
