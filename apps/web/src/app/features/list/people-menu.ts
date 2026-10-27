import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import type { Person } from '@promus/shared';
import { Household } from '../../core/household';
import { Face } from '../../shared/face';
import { untilDay } from './share-sheet';

/** "with" and the faces of everyone else on the list; tapped, everyone's full name, and until when the link works. */
@Component({
  selector: 'app-people-menu',
  imports: [MatMenu, MatMenuItem, MatMenuTrigger, MatDivider, MatIcon, TranslocoDirective, Face],
  template: `
    <ng-container *transloco="let t">
      @let guest = t('guest.name');
      @let shown = others();
      @if (shown.length) {
        <button
          class="with"
          [matMenuTriggerFor]="menu"
          [attr.aria-label]="t('list.withLabel', { names: names(guest) })"
        >
          {{ t('list.with') }}
          @for (p of shown.slice(0, 3); track p.id) {
            <app-face [member]="{ id: p.id, username: p.name ?? guest }" [guest]="p.guest" />
          }
          @if (shown.length > 3) {
            +{{ shown.length - 3 }}
          }
        </button>
      }
      <mat-menu #menu="matMenu" class="people-menu" [aria-label]="t('list.peopleOn', { list: list() })">
        <div class="heading">{{ t('list.peopleOn', { list: list() }) }}</div>
        @for (p of everyone(); track p.id) {
          <button mat-menu-item class="person">
            <span class="row">
              <app-face [member]="{ id: p.id, username: p.name ?? guest }" [guest]="p.guest" />
              <span class="name">{{ p.name ?? guest }}</span>
              <span class="tag">{{ p.id === household.you() ? t('settings.you') : p.guest ? guest : '' }}</span>
            </span>
          </button>
        }
        @if (day(); as d) {
          <mat-divider />
          <button mat-menu-item class="until"><mat-icon svgIcon="link" />{{ t('list.linkUntil', { date: d }) }}</button>
        }
      </mat-menu>
    </ng-container>
  `,
  styles: `
    :host {
      display: contents;
    }
    // as tall as the faces, so the band never moves; the press shows around them
    .with {
      --face-size: 1.375rem;
      display: flex;
      align-items: center;
      gap: 0.375rem;
      margin: -0.125rem 0 -0.125rem -0.25rem;
      padding: 0.125rem 0.375rem 0.125rem 0.25rem;
      border: 0;
      border-radius: var(--mat-sys-corner-full);
      background: none;
      color: rgb(255 255 255 / 0.7);
      font: inherit;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;

      @media (hover: hover) {
        &:hover {
          background: rgb(255 255 255 / 0.08);
        }
      }

      &[aria-expanded='true'] {
        background: rgb(255 255 255 / 0.16);
      }

      // on the band, where the theme's own focus color barely shows
      &:focus-visible {
        outline: 3px solid var(--promus-accent);
      }
    }
    // as the list menu's
    .heading {
      padding: 0.75rem 0.75rem 0.5rem;
      overflow: hidden;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-title-small);
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .row {
      --face-size: 2.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tag,
    .until {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.875rem;
    }
    // mat-menu-item sizes its icons for actions; this one only marks the line
    .until mat-icon {
      width: 1.125rem;
      height: 1.125rem;
      margin-inline-end: 0.625rem;
      color: inherit;
    }
  `,
})
export class PeopleMenu {
  protected readonly household = inject(Household);
  private readonly lang = toSignal(inject(TranslocoService).langChanges$, { requireSync: true });
  /** Everyone on the list, you included. */
  readonly people = input.required<Person[]>();
  /** When the list's link stops working; null without a live link. */
  readonly until = input<number | null>(null);
  readonly list = input.required<string>();

  protected readonly others = computed(() => this.people().filter((p) => p.id !== this.household.you()));
  protected readonly everyone = computed(() => [
    ...this.people().filter((p) => p.id === this.household.you()),
    ...this.others(),
  ]);
  protected readonly day = computed(() => {
    const at = this.until();
    return at === null ? null : untilDay(at, this.lang());
  });
  private readonly listFormat = computed(() => new Intl.ListFormat(this.lang(), { type: 'conjunction' }));

  protected names(guest: string): string {
    return this.listFormat().format(this.others().map((p) => p.name ?? guest));
  }
}
