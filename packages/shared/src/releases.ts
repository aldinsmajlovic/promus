/** A release newer than the server's, from its GitHub release: the changelog's bullets, per language. */
export type Release = { version: string; notes: { en: string[]; sv: string[] } };
