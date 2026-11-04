import { describe, expect, it } from 'vitest';
import { openApiDocument } from '../src/openapi.ts';
import { makeTestApp } from './helpers.ts';

describe('the OpenAPI document', () => {
  const { app } = makeTestApp();

  it('serves the document without a token', async () => {
    const res = await app.request('/api/v1/openapi.json', { headers: { Host: 'promus.test' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ openapi: '3.1.0', info: { title: 'Promus API' } });
  });

  it('documents every /api/v1 route, and no route that does not exist', () => {
    const routes = app.routes
      .filter((r) => r.path.startsWith('/api/v1/') && r.method !== 'ALL')
      .map((r) => `${r.method} ${r.path.slice('/api/v1'.length).replace(/:(\w+)/g, '{$1}')}`);
    const doc = openApiDocument() as { paths: Record<string, Record<string, unknown>> };
    const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`));
    expect(new Set(documented)).toEqual(new Set(routes));
  });

  it('describes the add body from the shared schema', () => {
    const doc = openApiDocument() as { components: { schemas: Record<string, unknown> } };
    expect(doc.components.schemas.AddItem).toMatchObject({ type: 'object', required: ['name'] });
  });
});
