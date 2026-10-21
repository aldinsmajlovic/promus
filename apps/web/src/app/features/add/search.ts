import uFuzzy from '@leeoniya/ufuzzy';
import { LIMITS, cleanName, entryKey, itemScore, normalizeName } from '@promus/shared';
import type { HouseholdState, ItemState } from '@promus/shared';

/** `ranges` are uFuzzy highlight ranges into `name`: [start0, end0, start1, end1, …]. */
export type SearchResult = { itemId: string; name: string; note: string | null; onList: boolean; ranges: number[] };
export type Segment = { text: string; hit: boolean };

const LIMIT = 20;
// one typo per word; its defaults already let 'mjlk' find Mjölk
const fuzzy = new uFuzzy({ intraMode: 1 });

/** The note it has on the list, or the one adding it would bring back. */
export function resultOf(state: HouseholdState, item: ItemState, listId: string, ranges: number[] = []): SearchResult {
  const entry = state.entries.get(entryKey(listId, item.id));
  const onList = entry?.state === 'active';
  return { itemId: item.id, name: item.name, note: onList ? entry.note : item.lastNote, onList, ranges };
}

/** Non-archived items matching `query`: the exact match first, then the most bought, then the best matched. */
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
  // than any name can match nothing, and would cost uFuzzy tens of ms per keystroke.
  const [, info, order] =
    needle.length > LIMITS.nameMax
      ? [null, null, null]
      : fuzzy.search(uFuzzy.latinize(items.map((i) => i.name)), uFuzzy.latinize(needle), 0, Infinity);
  const matches = (order ?? []).map((o) => ({ item: items[info!.idx[o]!]!, ranges: info!.ranges[o]! }));

  const exactId = state.byName.get(normalizeName(query))?.values().next().value;
  const exact = exactId === undefined ? undefined : state.items.get(exactId);
  // a name uFuzzy can't split into words (no letters or digits) is still found exactly
  if (exact && !matches.some((m) => m.item === exact)) matches.unshift({ item: exact, ranges: [] });
  const rank = new Map(matches.map(({ item }) => [item, item === exact ? Infinity : itemScore(item, now)]));
  // stable, so equal scores keep uFuzzy's order
  matches.sort((a, b) => rank.get(b.item)! - rank.get(a.item)!);

  const results = matches.slice(0, LIMIT).map((m) => resultOf(state, m.item, listId, m.ranges));
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
