import { mkdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
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

  it('caches only hashed build files as immutable, everything else no-cache', async () => {
    const { app, webRoot } = makeTestApp();
    mkdirSync(join(webRoot, 'media'));
    mkdirSync(join(webRoot, 'icons'));
    const files = {
      'main-4FBLEPWP.js': 'console.log(1)',
      'media/roboto-latin-400-normal-LOX3CHMS.woff2': '',
      'manifest.webmanifest': '{}',
      'ngsw-worker.js': '',
      'ngsw.json': '{}',
      'icons/icon-192.png': '',
    };
    for (const [path, body] of Object.entries(files)) writeFileSync(join(webRoot, path), body);
    const cacheOf = async (path: string) => (await app.request(path)).headers.get('cache-control');

    const immutable = 'public, max-age=31536000, immutable';
    const js = await app.request('/main-4FBLEPWP.js');
    expect(js.headers.get('content-type')).toContain('javascript');
    expect(js.headers.get('cache-control')).toBe(immutable);
    expect(await cacheOf('/media/roboto-latin-400-normal-LOX3CHMS.woff2')).toBe(immutable);
    const unhashed = ['/manifest.webmanifest', '/ngsw-worker.js', '/ngsw.json', '/icons/icon-192.png', '/'];
    for (const path of unhashed) expect(await cacheOf(path), path).toBe('no-cache');
  });

  it('serves assets when the web root ends with a separator, as DEFAULT_WEB_ROOT does', async () => {
    const { webRoot } = makeTestApp();
    writeFileSync(join(webRoot, 'main-abc.js'), 'console.log(1)');
    const { app } = makeTestApp({ webRoot: webRoot + sep });
    const res = await app.request('/main-abc.js');
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe('console.log(1)');
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
