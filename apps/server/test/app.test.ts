import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers.ts';

describe('app', () => {
  it('health returns ok', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('sets security headers', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/api/health');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('same-origin');
  });

  it('sends no CORS headers even for a foreign Origin', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
  });

  it('falls back to index.html for app routes with no-cache', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/some/app/route');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Promus</title>');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('returns JSON 404 when the web root has no index.html', async () => {
    const { app } = makeTestApp({ webRoot: '/nonexistent-promus-root' });
    const res = await app.request('/anything');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('never leaks files or returns 500 for hostile paths', async () => {
    const { app } = makeTestApp();
    for (const path of ['/%2e%2e/%2e%2e/etc/passwd', '/..%2f..%2f..%2fetc/passwd', '/a.js%00', '/%E0%A4%A', '/%', '/index.html/x', '/' + 'a'.repeat(5000)]) {
      const res = await app.request(path);
      expect(res.status, path).toBeLessThan(500);
      expect(await res.text(), path).not.toContain('root:');
    }
  });

  it('serves assets with their type and immutable caching, ngsw.json uncached', async () => {
    const { app, webRoot } = makeTestApp();
    writeFileSync(join(webRoot, 'main-abc.js'), 'console.log(1)');
    writeFileSync(join(webRoot, 'ngsw.json'), '{}');
    const js = await app.request('/main-abc.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await app.request('/ngsw.json')).headers.get('cache-control')).toBe('no-cache');
  });

  it('never serves index.html for /api or /api/', async () => {
    const { app } = makeTestApp();
    for (const path of ['/api', '/api/']) {
      const res = await app.request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('returns JSON 404 for non-GET requests outside /api', async () => {
    const { app } = makeTestApp();
    const res = await app.request('/x', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});
