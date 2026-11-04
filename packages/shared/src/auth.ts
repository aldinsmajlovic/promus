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

/** A household on demand, for someone who has none; `locale` names its default list. */
export const householdCreateSchema = z.object({ locale: z.enum(['sv', 'en']).optional() });
export type HouseholdCreate = z.infer<typeof householdCreateSchema>;

export type InviteCheck = { expiresAt: number; invitedBy: string; ownHousehold: boolean };

/** A household member, as Settings lists them. `former` is true after they left or were removed; members cached by older versions lack it. */
export type Member = { id: string; username: string; role: string; former: boolean };

export const TOKEN_NAME_MAX = 50;
export const tokenCreateSchema = z.strictObject({ name: z.string().trim().min(1).max(TOKEN_NAME_MAX) });
export type TokenCreate = z.infer<typeof tokenCreateSchema>;

/** An API token as Settings lists it; `lastUsedAt` is null until its first use. */
export type ApiToken = { id: string; name: string; createdAt: number; lastUsedAt: number | null };
/** The only time the token itself is shown. */
export type TokenCreated = { id: string; token: string };
