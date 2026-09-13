/** A negative statistical conclusion is unsupported when no group was evaluable. */
export function containsUnsupportedNegativeAnomalyClaim(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-MX");
  return /\b(?:no\s+(?:se\s+)?(?:identificaron|detectaron|encontraron|observaron|registraron|hay|hubo)|sin)(?:\s+\S+){0,8}\s+(?:anomalias?|inusual(?:es)?|atipic[oa]s?)\b/u.test(normalized);
}
