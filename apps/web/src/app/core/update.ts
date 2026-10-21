import { DOCUMENT, Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { SwUpdate } from '@angular/service-worker';
import { TranslocoService } from '@jsverse/transloco';
import { filter, merge } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);
  private readonly snackBar = inject(MatSnackBar);
  private readonly transloco = inject(TranslocoService);
  private readonly doc = inject(DOCUMENT);

  start(): void {
    if (!this.sw.isEnabled) return;
    merge(
      this.sw.versionUpdates.pipe(filter((e) => e.type === 'VERSION_READY')),
      this.sw.unrecoverable,
    ).subscribe(() => this.offerReload());
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'visible') void this.sw.checkForUpdate();
    });
  }

  private offerReload(): void {
    const t = (key: string) => this.transloco.translate(key);
    this.snackBar
      .open(t('update.ready'), t('update.reload'))
      .onAction()
      .subscribe(() => this.doc.location.reload());
  }
}
