const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;

// zero-width characters go before NFC: one between a letter and its combining mark would block the composition
export function cleanName(name: string): string {
  return name.replace(ZERO_WIDTH, '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function normalizeName(name: string): string {
  return cleanName(name).toLowerCase();
}
