import { Component, input } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { HTTPS_GUIDE_URL } from '../core/docs';

/** In place of a form that can't work: over plain HTTP the browser drops the Secure session cookie. */
@Component({
  selector: 'app-https-notice',
  imports: [TranslocoDirective],
  template: `
    <ng-container *transloco="let t">
      <h2>{{ t('https.needed') }}</h2>
      <p>{{ t(reason()) }}</p>
      <p><a [href]="guide" target="_blank" rel="noopener">{{ t('https.guide') }}</a></p>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
      font: var(--mat-sys-body-large);
      letter-spacing: var(--mat-sys-body-large-tracking);
    }
    h2 {
      margin: 0 0 0.75rem;
      font: var(--mat-sys-title-large);
      color: var(--mat-sys-error);
    }
    p {
      margin: 0 0 0.75rem;
    }
    a {
      color: var(--mat-sys-primary);
    }
  `,
})
export class HttpsNotice {
  /** `https.how` before signing in; `https.cookie` when the browser dropped the cookie after. */
  readonly reason = input<'https.how' | 'https.cookie'>('https.how');
  protected readonly guide = HTTPS_GUIDE_URL;
}
