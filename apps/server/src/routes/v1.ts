import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  apiAddItemSchema, apiSetCheckedSchema, applyEvent, entryOf, fold, listSummaries, listView, normalizeName, planAddByName,
  planCheck, planRemove, planUncheck,
} from '@promus/shared';
import type { ApiItem, ApiList, Draft, HouseholdState } from '@promus/shared';
import type { AppDeps, AppEnv } from '../app.ts';
import { householdEvents, insertServerEvents } from '../events-repo.ts';
import { requireAuth, requireScope } from '../middleware/auth.ts';
import { openApiDocument } from '../openapi.ts';

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'payload_too_large' }, 413) });

// Swedish puts å, ä and ö after z; English names sort the same either way
const collator = new Intl.Collator('sv', { numeric: true });

type At = { householdId: string; listId: string; state: HouseholdState };

const apiItem = (state: HouseholdState, listId: string, itemId: string): ApiItem => {
  const found = entryOf(state, listId, itemId);
  if (!found) throw new Error(`item ${itemId} is not on list ${listId}`);
  const { item, entry } = found;
  const checked = entry.state === 'checked';
  return { id: item.id, name: item.name, checked, later: !checked && entry.later, quantity: entry.quantity, note: entry.note };
};

/**
 * The versioned API for other apps, with an API token. Each change is planned as the app plans it. From the fold to
 * the write there is no await: node:sqlite is synchronous, so no other request's write can come in between.
 */
export function v1Routes({ db, now }: Pick<AppDeps, 'db' | 'now' | 'logger'>) {
  /** The token's household, folded, when the list is a live one of it. */
  const listAt = (c: Context<AppEnv>, listId: string): At | null => {
    const householdId = c.get('auth').householdIds[0];
    if (householdId === undefined) return null;
    const state = fold(householdEvents(db, householdId));
    return state.lists.get(listId)?.deleted === false ? { householdId, listId, state } : null;
  };
  /** Stored as the token's user and session, then applied: they sort after everything folded, as a fresh fold would. */
  const write = (c: Context<AppEnv>, { householdId, state }: At, drafts: Draft[]): void => {
    const { userId, sessionId } = c.get('auth');
    for (const e of insertServerEvents(db, householdId, { userId, sessionId }, drafts, now())) applyEvent(state, { ...e, userId });
  };
  const notFound = (c: Context<AppEnv>) => c.json({ error: 'not_found' }, 404);
  const invalid = (c: Context<AppEnv>) => c.json({ error: 'invalid_request' }, 400);

  return new Hono<AppEnv>()
    .get('/openapi.json', (c) => c.json(openApiDocument()))
    .use(requireAuth('api'))
    .get('/lists', requireScope('lists:read'), (c) => {
      const householdId = c.get('auth').householdIds[0];
      const state = householdId === undefined ? null : fold(householdEvents(db, householdId));
      const lists: ApiList[] = state
        ? listSummaries(state, collator).map(({ id, name, activeCount }) => ({ id, name, toGet: activeCount }))
        : [];
      return c.json({ lists });
    })
    .get('/lists/:listId/items', requireScope('lists:read'), (c) => {
      const at = listAt(c, c.req.param('listId'));
      if (!at) return notFound(c);
      const { active, later, done } = listView(at.state, at.listId, now(), collator);
      return c.json({ items: [...active, ...later, ...done].map((e) => apiItem(at.state, at.listId, e.itemId)) });
    })
    .post('/lists/:listId/items', requireScope('lists:write'), small, async (c) => {
      const body = apiAddItemSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return invalid(c);
      const at = listAt(c, c.req.param('listId'));
      if (!at) return notFound(c);
      const { name } = body.data;
      const plan = planAddByName(at.state, at.listId, name);
      if (plan) write(c, at, plan.drafts);
      // the add put it there, or it was there already
      const itemId = at.state.byName.get(normalizeName(name))?.values().next().value;
      return c.json(apiItem(at.state, at.listId, itemId!), plan ? 201 : 200);
    })
    .patch('/lists/:listId/items/:itemId', requireScope('lists:write'), small, async (c) => {
      const body = apiSetCheckedSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return invalid(c);
      const at = listAt(c, c.req.param('listId'));
      const itemId = c.req.param('itemId');
      if (!at || !entryOf(at.state, at.listId, itemId)) return notFound(c);
      const plan = (body.data.checked ? planCheck : planUncheck)(at.state, at.listId, itemId);
      if (plan) write(c, at, plan.drafts);
      return c.json(apiItem(at.state, at.listId, itemId));
    })
    .delete('/lists/:listId/items/:itemId', requireScope('lists:write'), (c) => {
      const at = listAt(c, c.req.param('listId'));
      const plan = at && planRemove(at.state, at.listId, c.req.param('itemId'));
      if (!at || !plan) return notFound(c);
      write(c, at, plan.drafts);
      return c.body(null, 204);
    });
}
