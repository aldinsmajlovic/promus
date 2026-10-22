import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { PromusDb } from './db';

export type ThemeMode = 'system' | 'light' | 'dark';

const COLOR_SCHEME: Record<ThemeMode, string> = {
  system: 'light dark',
  light: 'light',
  dark: 'dark',
};

/** The light/dark choice, kept in meta `theme`. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);
  private readonly db = inject(PromusDb);
  private readonly current = signal<ThemeMode>('system');
  readonly mode = this.current.asReadonly();

  /** Applies the saved mode. */
  async load(): Promise<void> {
    this.apply((await this.db.getMeta('theme')) ?? 'system');
  }

  /** Applies the mode at once, then saves it. */
  set(mode: ThemeMode): Promise<void> {
    this.apply(mode);
    return this.db.setMeta('theme', mode);
  }

  private apply(mode: ThemeMode): void {
    this.current.set(mode);
    this.doc.documentElement.style.colorScheme = COLOR_SCHEME[mode];
    // the browser bar too: the chosen scheme's colour always, the other never
    for (const meta of this.doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"][data-scheme]')) {
      const scheme = meta.dataset['scheme'];
      meta.media = mode === 'system' ? `(prefers-color-scheme: ${scheme})` : mode === scheme ? 'all' : 'not all';
    }
  }
}
