import {
  apiAddItemSchema, apiErrorSchema, apiItemSchema, apiItemsSchema, apiListsSchema, apiListSchema, apiSetCheckedSchema,
} from '@promus/shared';
import * as z from 'zod';
import pkg from '../../../package.json' with { type: 'json' };

const input = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', target: 'draft-2020-12' });
const output = (s: z.ZodType) => z.toJSONSchema(s, { io: 'output', target: 'draft-2020-12' });

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: string) => ({ 'application/json': { schema: ref(name) } });
const body = (name: string) => ({ required: true, content: json(name) });
const ok = (status: string, description: string, name: string) => ({ [status]: { description, content: json(name) } });
const fail = (description: string, ...statuses: string[]) =>
  Object.fromEntries(statuses.map((s) => [s, { description, content: json('Error') }]));

const listId = { name: 'listId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const itemId = { name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const bad = fail('The body is not valid', '400');
const errors = { ...fail('No token, or an unknown, revoked or expired one', '401'), ...fail('Not a token, or a token without the scope', '403') };
const notFound = fail('The list is not one of the household\'s, or the item is not on it', '404');
const tooLarge = fail('The body is over 4 KB', '413');

/** The OpenAPI 3.1 document of `/api/v1`, with the schemas the routes validate with. */
export function openApiDocument(): object {
  return {
    openapi: '3.1.0',
    info: { title: 'Promus API', version: pkg.version },
    components: {
      securitySchemes: { token: { type: 'http', scheme: 'bearer' } },
      schemas: {
        List: output(apiListSchema),
        Lists: output(apiListsSchema),
        Item: output(apiItemSchema),
        Items: output(apiItemsSchema),
        AddItem: input(apiAddItemSchema),
        SetChecked: input(apiSetCheckedSchema),
        Error: output(apiErrorSchema),
      },
    },
    servers: [{ url: '/api/v1' }],
    security: [{ token: [] }],
    paths: {
      '/openapi.json': {
        get: { summary: 'This document', security: [], responses: { '200': { description: 'The OpenAPI document' } } },
      },
      '/lists': {
        get: { summary: 'The household\'s lists', responses: { ...ok('200', 'The lists', 'Lists'), ...errors } },
      },
      '/lists/{listId}/items': {
        get: { parameters: [listId], summary: 'What\'s on a list', responses: { ...ok('200', 'The items', 'Items'), ...errors, ...notFound } },
        post: {
          parameters: [listId],
          summary: 'Add an item by name',
          requestBody: body('AddItem'),
          responses: {
            ...ok('201', 'The item, added or brought back', 'Item'),
            ...ok('200', 'The item was on the list already', 'Item'),
            ...bad, ...errors, ...notFound, ...tooLarge,
          },
        },
      },
      '/lists/{listId}/items/{itemId}': {
        patch: {
          parameters: [listId, itemId],
          summary: 'Check an item off, or uncheck it',
          requestBody: body('SetChecked'),
          responses: { ...ok('200', 'The item', 'Item'), ...bad, ...errors, ...notFound, ...tooLarge },
        },
        delete: {
          parameters: [listId, itemId],
          summary: 'Take an item off the list',
          responses: { '204': { description: 'The item is off the list' }, ...errors, ...notFound },
        },
      },
    },
  };
}
