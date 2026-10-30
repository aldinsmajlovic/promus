import uFuzzy from '@leeoniya/ufuzzy';
import Fuse from 'fuse.js';
import { LIMITS, cleanName, entryKey, inDoneWindow, itemScore, normalizeName } from '@promus/shared';
import type { HouseholdState, ItemState } from '@promus/shared';

/** `ranges` are uFuzzy highlight ranges into `name`: [start0, end0, start1, end1, …]. */
export type SearchResult = {
  itemId: string;
  name: string;
  note: string | null;
  quantity: number;
  /** On the list, checked off inside the Done window (also on the list's Done), or neither. */
  state: 'none' | 'active' | 'checked';
  ranges: number[];
};
export type Segment = { text: string; hit: boolean };

const LIMIT = 20;
// one typo per word; its defaults already let 'mjlk' find Mjölk
const fuzzy = new uFuzzy({ intraMode: 1 });

/** Up to five words in any order (5! orders tried); past that uFuzzy only filters, unranked: in the order typed. */
function find(haystack: string[], needle: string): uFuzzy.SearchResult {
  const found = fuzzy.search(haystack, needle, 5, Infinity);
  return found[1] ? found : fuzzy.search(haystack, needle, 0, Infinity);
}

/**
 * Fuse's guesses at its default threshold, for when nothing matches letter for letter: "köttbulle" finds Köttfärs.
 * Equally good guesses go most bought first. About 15 ms for 3 000 names.
 */
function alike(items: ItemState[], needle: string, now: number): ItemState[] {
  return new Fuse(items, { keys: ['name'], ignoreLocation: true, ignoreDiacritics: true, includeScore: true })
    .search(needle)
    .sort((a, b) => a.score! - b.score! || itemScore(b.item, now) - itemScore(a.item, now))
    .map((r) => r.item);
}

/** The note and quantity it has on the list, or the ones adding it would bring back. */
export function resultOf(
  state: HouseholdState,
  item: ItemState,
  listId: string,
  now: number,
  ranges: number[] = [],
): SearchResult {
  const entry = state.entries.get(entryKey(listId, item.id));
  const shown = entry?.state === 'active' || (entry && inDoneWindow(entry, now)) ? entry : undefined;
  return {
    itemId: item.id,
    name: item.name,
    note: shown ? shown.note : item.lastNote,
    quantity: shown ? shown.quantity : item.lastQuantity,
    state: shown?.state ?? 'none',
    ranges,
  };
}

/**
 * Non-archived items matching `query`: the exact match first, then the most bought, then the best matched. With no
 * match at all, Fuse's guesses.
 */
export function searchItems(
  state: HouseholdState,
  query: string,
  listId: string,
  now: number,
): { results: SearchResult[]; exact: SearchResult | null } {
  const items = [...state.items.values()].filter((i) => !i.archived);
  const needle = cleanName(query);
  // latinize swaps one accented letter for one plain one, so the ranges also index the original names.
  // Infinity ranks every match (the default stops above 1 000): a few ms for 3 000 names. A needle longer
  // than any name can match nothing, and would cost uFuzzy and Fuse tens of ms per keystroke.
  const long = needle.length > LIMITS.nameMax;
  const [, info, order] = long
    ? [null, null, null]
    : find(uFuzzy.latinize(items.map((i) => i.name)), uFuzzy.latinize(needle));
  const matches = (order ?? []).map((o) => ({ item: items[info!.idx[o]!]!, ranges: info!.ranges[o]! }));

  const exactId = state.byName.get(normalizeName(query))?.values().next().value;
  const exact = exactId === undefined ? undefined : state.items.get(exactId);
  // a name uFuzzy can't split into words (no letters or digits) is still found exactly
  if (exact && !matches.some((m) => m.item === exact)) matches.unshift({ item: exact, ranges: [] });
  const rank = new Map(matches.map(({ item }) => [item, item === exact ? Infinity : itemScore(item, now)]));
  // stable, so equal scores keep uFuzzy's order
  matches.sort((a, b) => rank.get(b.item)! - rank.get(a.item)!);
  // nothing letter for letter: Fuse's guesses, with nothing marked
  const shown = matches.length || long ? matches : alike(items, needle, now).map((item) => ({ item, ranges: [] }));

  const results = shown.slice(0, LIMIT).map((m) => resultOf(state, m.item, listId, now, m.ranges));
  return { results, exact: exact ? results[0]! : null };
}

/** `name` cut into matched and unmatched runs, for bold matches without innerHTML. */
export function segments(name: string, ranges: number[]): Segment[] {
  // highlight() repeats the whole name when there are no ranges
  if (ranges.length === 0) return [{ text: name, hit: false }];
  return uFuzzy.highlight<Segment[], Segment>(
    name,
    ranges,
    (text, hit) => ({ text, hit }),
    [],
    (all, s) => (s.text ? [...all, s] : all),
  );
}
