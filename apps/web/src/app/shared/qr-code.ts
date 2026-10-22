import { Component, computed, input } from '@angular/core';
import qrcode from 'qrcode-generator';

// the quiet zone the QR standard asks for, in modules
const QUIET = 4;

/**
 * A QR code as inline SVG: a CSP-safe path, no `data:` image and no innerHTML. Always dark on white,
 * in either theme: many scanners can't read an inverted code.
 */
@Component({
  selector: 'app-qr-code',
  template: `
    <svg [attr.viewBox]="'0 0 ' + code().size + ' ' + code().size" role="img" [attr.aria-label]="text()" shape-rendering="crispEdges">
      <rect [attr.width]="code().size" [attr.height]="code().size" fill="#fff" />
      <path [attr.d]="code().d" fill="#000" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: 12rem;
      max-width: 100%;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
    }
  `,
})
export class QrCode {
  readonly text = input.required<string>();

  protected readonly code = computed(() => {
    // type 0: the smallest version that fits; M recovers from 15% damage
    const qr = qrcode(0, 'M');
    qr.addData(this.text());
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    }
    return { size: n + 2 * QUIET, d };
  });
}
