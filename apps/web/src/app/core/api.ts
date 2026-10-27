import { Injectable, InjectionToken, inject } from '@angular/core';
import {
  ApiError,
  AuthError,
  NetworkError,
  guestNameSchema,
  inviteAcceptSchema,
  inviteTokenSchema,
  loginRequestSchema,
  setupRequestSchema,
  shareCreateSchema,
  shareJoinSchema,
  shareTokenSchema,
} from '@promus/shared';
import type {
  EventInput,
  GuestMe,
  InviteAccept,
  Member,
  PullResponse,
  PushResponse,
  SetupRequest,
  Share,
  ShareCheck,
  ShareJoined,
  SharesResponse,
  SyncApi,
} from '@promus/shared';

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

  me(): Promise<{ user: User; households: { id: string; role: string; members: Member[] }[] }> {
    return this.request('GET', '/api/me');
  }

  async setupNeeded(): Promise<boolean> {
    return (await this.request<{ needed: boolean }>('GET', '/api/setup')).needed;
  }

  setup(req: SetupRequest): Promise<void> {
    return this.request('POST', '/api/setup', setupRequestSchema.parse(req));
  }

  createInvite(): Promise<{ id: string; token: string; expiresAt: number }> {
    return this.request('POST', '/api/invites');
  }

  revokeInvite(id: string): Promise<void> {
    return this.request('DELETE', `/api/invites/${encodeURIComponent(id)}`);
  }

  // tokens only ever in a body: the server logs every path
  checkInvite(token: string): Promise<{ expiresAt: number; invitedBy: string }> {
    return this.request('POST', '/api/invites/check', inviteTokenSchema.parse({ token }));
  }

  acceptInvite(req: InviteAccept): Promise<void> {
    return this.request('POST', '/api/invites/accept', inviteAcceptSchema.parse(req));
  }

  /** The list's live link, or a new one: `created` says which. */
  async createShare(listId: string): Promise<{ share: Share; created: boolean }> {
    const res = await this.send<Share>('POST', '/api/shares', shareCreateSchema.parse({ listId }));
    return { share: res.body, created: res.status === 201 };
  }

  shares(): Promise<SharesResponse> {
    return this.request('GET', '/api/shares');
  }

  endShare(id: string): Promise<void> {
    return this.request('DELETE', `/api/shares/${encodeURIComponent(id)}`);
  }

  restoreShare(id: string): Promise<void> {
    return this.request('POST', `/api/shares/${encodeURIComponent(id)}/restore`);
  }

  checkShare(token: string): Promise<ShareCheck> {
    return this.request('POST', '/api/guest/check', shareTokenSchema.parse({ token }));
  }

  joinShare(token: string, name?: string): Promise<ShareJoined> {
    return this.request('POST', '/api/guest/join', shareJoinSchema.parse({ token, name }));
  }

  guestMe(shareId: string): Promise<GuestMe> {
    return this.request('GET', `/api/guest/${encodeURIComponent(shareId)}/me`);
  }

  renameGuest(shareId: string, name: string): Promise<void> {
    return this.request('PUT', `/api/guest/${encodeURIComponent(shareId)}/name`, guestNameSchema.parse({ name }));
  }

  /** Sync as a guest of one link: the same calls as the household's, scoped to its list. */
  guestSync(shareId: string): SyncApi {
    const base = `/api/guest/${encodeURIComponent(shareId)}`;
    return {
      push: (events) => this.request('POST', `${base}/push`, { events }),
      pull: (after, limit) => this.request('GET', `${base}/pull?after=${after}&limit=${limit}`),
    };
  }

  push(events: EventInput[]): Promise<PushResponse> {
    return this.request('POST', '/api/sync/push', { events });
  }

  pull(after: number, limit: number): Promise<PullResponse> {
    return this.request('GET', `/api/sync/pull?after=${after}&limit=${limit}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return (await this.send<T>(method, path, body)).body;
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
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
    if (res.ok) return { status: res.status, body: (text === '' ? undefined : JSON.parse(text)) as T };
    const code = errorCode(text);
    if (res.status === 401) throw new AuthError(code);
    throw new ApiError(res.status, code ?? 'unknown');
  }
}
