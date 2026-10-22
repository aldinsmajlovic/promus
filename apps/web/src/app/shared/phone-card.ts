import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { TranslocoDirective } from '@jsverse/transloco';
import { HTTPS_GUIDE_URL } from '../core/docs';
import { InstallService } from '../core/install';
import { ORIGIN, isLocalOrigin } from '../core/platform';
import { QrCode } from './qr-code';

/** Getting the app onto a phone: this address as a QR code, and how to install it on this device. */
@Component({
  selector: 'app-phone-card',
  imports: [MatButton, TranslocoDirective, QrCode],
  template: `
    <ng-container *transloco="let t">
      @if (local) {
        <p>{{ t('phone.local') }}</p>
        <p><a [href]="guide" target="_blank" rel="noopener">{{ t('https.guide') }}</a></p>
      } @else {
        <p>{{ t('phone.scan') }}</p>
        <app-qr-code [text]="origin" />
        <p class="address">{{ origin }}</p>
      }
      @if (!install.installed()) {
        @if (install.canPrompt()) {
          <button matButton="filled" type="button" (click)="install.prompt()">{{ t('install.button') }}</button>
        } @else {
          <p>{{ t(install.platform === 'ios' ? 'install.ios' : 'install.other') }}</p>
        }
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
      font: var(--mat-sys-body-medium);
      letter-spacing: var(--mat-sys-body-medium-tracking);
    }
    p {
      margin: 0;
    }
    .address {
      overflow-wrap: anywhere;
      color: var(--mat-sys-on-surface-variant);
    }
    a {
      color: var(--mat-sys-primary);
    }
  `,
})
export class PhoneCard {
  protected readonly install = inject(InstallService);
  protected readonly origin = inject(ORIGIN);
  protected readonly local = isLocalOrigin(this.origin);
  protected readonly guide = HTTPS_GUIDE_URL;
}
