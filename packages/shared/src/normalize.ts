const ZERO_WIDTH = /[​-‍⁠﻿]/g;

export function cleanName(name: string): string {
  return name.normalize('NFC').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim();
}

export function normalizeName(name: string): string {
  return cleanName(name).toLowerCase();
}
