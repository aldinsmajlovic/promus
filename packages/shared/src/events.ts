import { z } from 'zod';
import { HLC_PATTERN } from './hlc.ts';
import { newId } from './ids.ts';
import { cleanName } from './normalize.ts';

export const LIMITS = {
  nameMax: 200,
  noteMax: 500,
  pushMaxEvents: 500,
  pushMaxBytes: 1_000_000,
  pullMaxLimit: 500,
  maxClockSkewMs: 3_600_000,
  doneWindowMs: 86_400_000,
} as const;

export const EVENT_TYPES = [
  'list.created', 'list.renamed', 'list.deleted', 'list.restored',
  'item.created', 'item.renamed', 'item.archived', 'item.unarchived',
  'entry.added', 'entry.checked', 'entry.unchecked', 'entry.removed', 'entry.noteSet',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const id = z.uuid();
const name = z.string().min(1).max(LIMITS.nameMax).refine((s) => s === cleanName(s), 'name must be clean');
const note = z.string().max(LIMITS.noteMax);

const event = <T extends EventType, P extends z.ZodRawShape>(type: T, payload: P) =>
  z.strictObject({
    id,
    householdId: id,
    type: z.literal(type),
    v: z.literal(1),
    hlc: z.string().regex(HLC_PATTERN),
    occurredAt: z.number().int().min(0),
    undoOf: id.optional(),
    payload: z.strictObject(payload),
  });

const list = { listId: id };
const itemP = { itemId: id };
const entry = { listId: id, itemId: id };

export const eventInputSchema = z.discriminatedUnion('type', [
  event('list.created', { ...list, name }),
  event('list.renamed', { ...list, name }),
  event('list.deleted', list),
  event('list.restored', list),
  event('item.created', { ...itemP, name }),
  event('item.renamed', { ...itemP, name }),
  event('item.archived', itemP),
  event('item.unarchived', itemP),
  event('entry.added', { ...entry, note: note.optional() }),
  event('entry.checked', entry),
  event('entry.unchecked', entry),
  event('entry.removed', entry),
  event('entry.noteSet', { ...entry, note }),
]);

export type EventInput = z.infer<typeof eventInputSchema>;
export type PayloadOf<T extends EventType> = Extract<EventInput, { type: T }>['payload'];
export type StoredEvent = EventInput & { seq: number; userId: string; receivedAt: number };
export type FoldEvent = Pick<EventInput, 'id' | 'type' | 'v' | 'hlc' | 'occurredAt' | 'undoOf' | 'payload'>;

export type RejectCode = 'invalid' | 'clock_skew' | 'forbidden_household';
export type PushResponse = {
  accepted: string[];
  rejected: { id: string | null; code: RejectCode; message: string }[];
  serverTime: number;
};
export type PullResponse = { events: StoredEvent[]; lastSeq: number; hasMore: boolean; serverTime: number };

export function parseEventInput(
  raw: unknown,
): { ok: true; event: EventInput } | { ok: false; id: string | null; message: string } {
  const r = eventInputSchema.safeParse(raw);
  if (r.success) return { ok: true, event: r.data };
  const rawId = (raw as { id?: unknown } | null)?.id;
  return { ok: false, id: typeof rawId === 'string' ? rawId : null, message: z.prettifyError(r.error) };
}

export function makeEvent<T extends EventType>(
  type: T,
  payload: PayloadOf<T>,
  meta: { householdId: string; hlc: string; occurredAt: number; undoOf?: string },
): EventInput {
  return { id: newId(), v: 1, type, payload, ...meta } as EventInput;
}
