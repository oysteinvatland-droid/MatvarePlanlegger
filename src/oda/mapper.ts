const UNIT_WORDS = new Set([
  'g', 'kg', 'ml', 'dl', 'l', 'stk', 'ss', 'ts',
  'neve', 'pakke', 'boks', 'pose', 'flaske', 'kanne',
]);

/**
 * Normaliser et ingrediensnavn til et Oda.no-søkeord.
 * Fjerner enhetsbetegnelser og tall.
 *
 * Eksempel: "400g laks filet" → "laks filet"
 */
export function toSearchQuery(
  ingredientName: string,
  hint?: string | null
): string {
  if (hint) return hint.trim();

  return ingredientName
    .toLowerCase()
    .split(/\s+/)
    .filter(w => !UNIT_WORDS.has(w) && !/^\d+([.,]\d+)?$/.test(w))
    .join(' ')
    .trim();
}
