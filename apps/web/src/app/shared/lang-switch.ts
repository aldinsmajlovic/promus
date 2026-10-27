import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton } from '@angular/material/button';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { type Lang, LangService } from '../core/i18n';

/** English and Svenska, at the bottom of a screen: this device's language from then on. */
@Component({
  selector: 'app-lang-switch',
  imports: [MatButton, TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      @for (l of langs; track l.value) {
        <button matButton type="button" [attr.aria-pressed]="lang() === l.value" (click)="set(l.value)">
          {{ t(l.label) }}
        </button>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      justify-content: center;
      gap: 0.5rem;
      margin-top: auto;
    }
    [aria-pressed='true'] {
      background: var(--promus-tint);
      color: var(--promus-tint-ink);
    }
  `,
})
export class LangSwitch {
  private readonly langService = inject(LangService);
  private readonly transloco = inject(TranslocoService);
  protected readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  protected readonly langs: { value: Lang; label: string }[] = [
    { value: 'en', label: 'settings.en' },
    { value: 'sv', label: 'settings.sv' },
  ];

  protected set(lang: Lang): void {
    this.langService.set(lang).catch((err: unknown) => console.error('language not saved', err));
  }
}
