// a namespace import, so bundlers keep only the zod parts used (`{ z }` pulls in every locale)
import * as z from 'zod';

export const loginRequestSchema = z.object({ username: z.string(), password: z.string() });
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** The server refuses shorter passwords; the forms say so up front. */
export const MIN_PASSWORD_LENGTH = 8;

/** A new account's name and password; the server checks length and cleanliness and answers with a code. */
export const accountSchema = z.object({ username: z.string(), password: z.string() });
export type Account = z.infer<typeof accountSchema>;

export const setupRequestSchema = accountSchema.extend({
  setupCode: z.string().max(100),
  locale: z.enum(['sv', 'en']),
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

/** `ownHousehold`: the invitee gets a household and lists of their own instead of joining yours. */
export const inviteCreateSchema = z.object({ ownHousehold: z.boolean().optional() });
export type InviteCreate = z.infer<typeof inviteCreateSchema>;

export const inviteTokenSchema = z.object({ token: z.string().min(1).max(100) });
/** `locale` names the default list of an own-household invite. */
export const inviteAcceptSchema = accountSchema.extend(inviteTokenSchema.shape).extend({ locale: z.enum(['sv', 'en']).optional() });
export type InviteAccept = z.infer<typeof inviteAcceptSchema>;

export type InviteCheck = { expiresAt: number; invitedBy: string; ownHousehold: boolean };

/** A household member, as Settings lists them. */
export type Member = { id: string; username: string; role: string };
