// a namespace import, so bundlers keep only the zod parts used (`{ z }` pulls in every locale)
import * as z from 'zod';

export const loginRequestSchema = z.object({ username: z.string(), password: z.string() });
export type LoginRequest = z.infer<typeof loginRequestSchema>;
