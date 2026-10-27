import { Component, type ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { ApiError, AuthError, GUEST_NAME_MAX, NetworkError, type ShareCheck } from '@promus/shared';
import { ApiClient } from '../../core/api';
import { PromusDb } from '../../core/db';
import { SessionService } from '../../core/session';
import { initialOf } from '../../shared/face';
import { LangSwitch } from '../../shared/lang-switch';
import { TOO_LONG } from './guest-sheet';

/**
 * A shared list's link, `/share#<token>`: the token stays in the fragment, which never reaches the server's logs.
 * A phone that already joined goes straight to the list, a member of the household to their own; anyone else
 * names themselves first.
 */
@Component({
  selector: 'app-share-page',
  imports: [
    ReactiveFormsModule,
    MatButton,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
    MatInput,
    TranslocoDirective,
    LangSwitch,
  ],
  template: `
    <ng-container *transloco="let t">
      <div class="frame">
        <header class="band hero">
          @if (check(); as c) {
            <span class="face tone-1" aria-hidden="true">{{ initialOf(c.sharedBy) }}</span>
            <h1 class="brand">{{ t('guest.shared', { name: c.sharedBy, list: c.listName }) }}</h1>
            <p class="lede">{{ t('guest.tagline') }}</p>
          }
        </header>

        <main class="sheet pad">
          @if (check()) {
            <form [formGroup]="form" (ngSubmit)="join()">
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>{{ t('guest.yourName') }}</mat-label>
                <input
                  #field
                  matInput
                  formControlName="name"
                  [maxlength]="max"
                  autocomplete="off"
                  autocapitalize="words"
                  enterkeyhint="go"
                />
                <mat-hint>{{ t('guest.nameHint') }}</mat-hint>
                @let refused = name.getError('refused');
                <mat-error>{{ refused && t(refused.key, refused.params) }}</mat-error>
              </mat-form-field>
              <button matButton="filled" type="submit" [disabled]="busy()">{{ t('guest.open') }}</button>
            </form>
          }
          <!-- always there, so screen readers announce what appears in it -->
          <p role="alert">
            @if (error(); as e) {
              {{ t(e) }}
            }
          </p>
          <app-lang-switch />
        </main>
      </div>
    </ng-container>
  `,
  styles: `
    .face {
      --face-size: 3rem;
      margin-block-end: 0.5rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
  `,
})
export class SharePage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly household = inject(PromusDb);
  private readonly signedIn = inject(SessionService).session() !== null;
  private readonly token = inject(ActivatedRoute).snapshot.fragment ?? '';
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  protected readonly check = signal<ShareCheck | null>(null);
  protected readonly form = new FormGroup({ name: new FormControl('', { nonNullable: true }) });
  protected readonly name = this.form.controls.name;
  protected readonly max = GUEST_NAME_MAX;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly initialOf = initialOf;
  // the guest exists once join succeeds: a retry only opens the list, or it would be a second guest
  private joined: string | null = null;

  constructor() {
    effect(() => this.field()?.nativeElement.focus());
    if (this.token === '') {
      void this.ended(null);
      return;
    }
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      const check = await this.api.checkShare(this.token);
      if (check.joined) return await this.open(check.shareId, false);
      const listId = await this.householdList(check.shareId);
      if (listId) {
        await this.household.setMeta('currentListId', listId);
        await this.router.navigateByUrl('/', { replaceUrl: true });
        return;
      }
      this.check.set(check);
    } catch (err) {
      this.failed(err, null);
    }
  }

  /** The list, when this browser's household is the link's: its links say so. Anyone else gets the name step. */
  private async householdList(shareId: string): Promise<string | null> {
    // no household on this browser: none of its endpoints to ask
    if (!this.signedIn) return null;
    try {
      return (await this.api.shares()).shares.find((s) => s.id === shareId)?.listId ?? null;
    } catch (err) {
      // signed out on the server, or offline: a guest then
      if (!(err instanceof AuthError || err instanceof NetworkError)) {
        console.error("the household's links failed", err);
      }
      return null;
    }
  }

  protected async join(): Promise<void> {
    const check = this.check();
    if (this.busy() || !check) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.joined ??= (await this.api.joinShare(this.token, this.name.value)).shareId;
      await this.open(this.joined, true);
    } catch (err) {
      this.busy.set(false);
      this.failed(err, check.sharedBy);
    }
  }

  /**
   * Opens the link's list from its own database, writing what the page needs first: after joining, or when this
   * browser has lost it. `ShareJoined` lacks the list and household, so they come from `me`.
   */
  private async open(shareId: string, joined: boolean): Promise<void> {
    const db = new PromusDb(`promus-guest-${shareId}`);
    try {
      if (joined || !(await db.getMeta('guest'))) {
        const me = await this.api.guestMe(shareId);
        const { householdId, listId, sharedBy, expiresAt } = me.share;
        await db.transaction('rw', db.meta, async () => {
          await db.setMeta('guest', { shareId, token: this.token, listId, householdId, sharedBy, expiresAt });
          await db.setMeta('session', { userId: me.guest.id, username: me.guest.name ?? '', householdId });
          await db.setMeta('currentListId', listId);
          await db.setMeta('me', me);
        });
      }
    } finally {
      db.close();
    }
    await this.router.navigate(['/s', shareId], { replaceUrl: true });
  }

  private failed(err: unknown, sharedBy: string | null): void {
    const code = err instanceof ApiError ? err.code : null;
    if (code === 'share_invalid') void this.ended(sharedBy);
    else if (code === 'share_full') void this.ended(sharedBy, true);
    else if (code === 'name_too_long') {
      this.name.setErrors(TOO_LONG);
      this.name.markAsTouched();
    } else if (err instanceof NetworkError) this.error.set('login.offline');
    else {
      console.error('opening the link failed', err);
      this.error.set('guest.failed');
    }
  }

  // the person goes in the navigation's state, never the URL: the server logs paths
  private ended(sharedBy: string | null, full = false): Promise<boolean> {
    return this.router.navigateByUrl('/share/ended', { state: { sharedBy, full }, replaceUrl: true });
  }
}
