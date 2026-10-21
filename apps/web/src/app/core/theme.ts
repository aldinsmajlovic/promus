import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

const COLOR_SCHEME: Record<ThemeMode, string> = {
  system: 'light dark',
  light: 'light',
  dark: 'dark',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly html = inject(DOCUMENT).documentElement;
  private readonly current = signal<ThemeMode>('system');
  readonly mode = this.current.asReadonly();

  set(mode: ThemeMode): void {
    this.current.set(mode);
    this.html.style.colorScheme = COLOR_SCHEME[mode];
  }
}
