import { Injectable, InjectionToken, inject } from '@angular/core';
import { ApiError, AuthError, NetworkError, loginRequestSchema } from '@promus/shared';
import type { EventInput, PullResponse, PushResponse, SyncApi } from '@promus/shared';

export type User = { id: string; username: string };

// called through a wrapper: a bare `fetch` stored on an object throws "Illegal invocation"
export const FETCH = new InjectionToken<typeof fetch>('FETCH', {
  factory: () => (input, init) => globalThis.fetch(input, init),
});

// an error body that isn't `{ error: string }` (a proxy's HTML page, say) still keeps its status
const errorCode = (text: string): string | undefined => {
  try {
    const body: unknown = JSON.parse(text);
    const code = (body as { error?: unknown } | null)?.error;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
};

/** The only place that calls `fetch`. */
@Injectable({ providedIn: 'root' })
export class ApiClient implements SyncApi {
  private readonly fetch = inject(FETCH);

  login(username: string, password: string): Promise<{ user: User; householdId: string | null }> {
    return this.request('POST', '/api/auth/login', loginRequestSchema.parse({ username, password }));
  }

  logout(): Promise<void> {
    return this.request('POST', '/api/auth/logout');
  }

  me(): Promise<{ user: User; households: { id: string; role: string }[] }> {
    return this.request('GET', '/api/me');
  }

  push(events: EventInput[]): Promise<PushResponse> {
    return this.request('POST', '/api/sync/push', { events });
  }

  pull(after: number, limit: number): Promise<PullResponse> {
    return this.request('GET', `/api/sync/pull?after=${after}&limit=${limit}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    let text: string;
    try {
      res = await this.fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          // past the service worker: it has nothing cached here, and it answers no network with a 504
          'ngsw-bypass': 'true',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      text = await res.text();
    } catch (err) {
      // fetch rejects with a TypeError when no response arrives, also when the body is cut off
      throw err instanceof TypeError ? new NetworkError(err.message, { cause: err }) : err;
    }
    if (res.ok) return (text === '' ? undefined : JSON.parse(text)) as T;
    const code = errorCode(text);
    if (res.status === 401) throw new AuthError(code);
    throw new ApiError(res.status, code ?? 'unknown');
  }
}
