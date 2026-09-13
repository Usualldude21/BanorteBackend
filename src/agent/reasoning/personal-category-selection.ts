const CATEGORY_ALIASES: Record<string, readonly string[]> = {
  housing: ["housing", "vivienda", "renta"],
  entertainment: ["entertainment", "entretenimiento", "ocio"],
  restaurants: ["restaurants", "restaurantes", "restaurante"],
  groceries: ["groceries", "supermercado", "despensa"],
  transport: ["transport", "transporte"],
  health: ["health", "salud", "farmacia"],
  subscriptions: ["subscriptions", "suscripciones"],
  education: ["education", "educacion"],
  other: ["other", "otros"],
};

export function normalizeCategoryText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-MX");
}

export function categoryIdentity(value: string): string {
  const normalized = normalizeCategoryText(value);
  return Object.entries(CATEGORY_ALIASES).find(([, aliases]) => aliases.includes(normalized))?.[0] ?? normalized;
}

export function selectedComparisonCategories(
  query: string,
  categories: readonly string[],
): string[] | undefined {
  const request = normalizeCategoryText(query.split(/nueva solicitud del usuario:/iu).at(-1) ?? query);
  if (!/\b(?:solo|solamente|unicamente|filtra(?:r)?|deja(?:me)?|enfoca(?:te)?)\b/u.test(request)) {
    return undefined;
  }
  const selected = categories.filter((category) => {
    const aliases = CATEGORY_ALIASES[categoryIdentity(category)] ?? [normalizeCategoryText(category)];
    return aliases.some((alias) => new RegExp(`(?:^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:$|[^a-z])`, "u").test(request));
  });
  return selected.length > 0 ? [...new Set(selected.map(categoryIdentity))] : undefined;
}
