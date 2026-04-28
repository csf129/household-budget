/**
 * Heuristic: inflows that are clearly account-to-account moves (e.g. Chase
 * "Online Banking transfer from CHK …") should not count as income when still
 * uncategorized.
 */
export function descriptionLooksLikeInternalBankTransfer(
  normalizedDescription: string,
  rawDescription: string,
): boolean {
  const s = `${normalizedDescription} ${rawDescription}`.toLowerCase();

  if (/online\s+banking\s+transfer\s+(from|to)\s+chk\b/.test(s)) return true;
  if (
    /online\s+banking\s+transfer/.test(s) &&
    /confirmation#?\s*\d/.test(s)
  ) {
    return true;
  }
  if (/\btransfer\s+(from|to)\s+chk\b/.test(s)) return true;
  if (/\bext\s+trs\s+fr\b/.test(s)) return true;
  if (/\bext\s+trs\s+to\b/.test(s)) return true;

  return false;
}
