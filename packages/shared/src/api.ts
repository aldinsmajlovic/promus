// a namespace import, so bundlers keep only the zod parts used (`{ z }` pulls in every locale)
import * as z from 'zod';
import { LIMITS } from './events.ts';
import { cleanName } from './normalize.ts';

// `/api/v1`, for other apps: what it answers and takes

/** `toGet`: what's left to buy, without Later. */
export const apiListSchema = z.object({ id: z.uuid(), name: z.string(), toGet: z.number().int().min(0) });
export const apiListsSchema = z.object({ lists: z.array(apiListSchema) });
export type ApiList = z.infer<typeof apiListSchema>;

/** `checked`: in Done. `later`: put off under Later; a checked item never is. */
export const apiItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  checked: z.boolean(),
  later: z.boolean(),
  quantity: z.number().int().min(1),
  note: z.string().nullable(),
});
export const apiItemsSchema = z.object({ items: z.array(apiItemSchema) });
export type ApiItem = z.infer<typeof apiItemSchema>;

/** A name as speech gives it: cleaned first, then 1 to `LIMITS.nameMax` characters. */
export const apiAddItemSchema = z.strictObject({ name: z.string().transform(cleanName).pipe(z.string().min(1).max(LIMITS.nameMax)) });
export const apiSetCheckedSchema = z.strictObject({ checked: z.boolean() });
export const apiErrorSchema = z.object({ error: z.string(), message: z.string().optional() });
