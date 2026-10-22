import { TestBed } from '@angular/core/testing';
import { TranslocoService } from '@jsverse/transloco';
import { newId } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import { startup } from './app.config';
import { FETCH } from './core/api';
import { PromusDb } from './core/db';
import { LangService, provideI18n } from './core/i18n';
import { SessionService } from './core/session';
import { SyncService } from './core/sync.service';
import { ThemeService } from './core/theme';
import { UpdateService } from './core/update';

describe('startup', () => {
  it('opens offline: preferences and session come from meta, sync starts in the background', async () => {
    const db = new PromusDb(`startup-${newId()}`);
    await db.setMeta('session', { userId: newId(), username: 'anna', householdId: newId() });
    await db.setMeta('theme', 'dark');
    await db.setMeta('lang', 'en');
    // the network never answers
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const update = { start: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: PromusDb, useValue: db },
        { provide: FETCH, useValue: fetch },
        { provide: UpdateService, useValue: update },
        provideI18n(),
      ],
    });
    await TestBed.runInInjectionContext(startup);
    try {
      expect(document.documentElement.style.colorScheme).toBe('dark');
      expect(TestBed.inject(ThemeService).mode()).toBe('dark');
      expect(TestBed.inject(LangService).pref()).toBe('en');
      expect(TestBed.inject(TranslocoService).translate('update.reload')).toBe('Reload');
      expect(document.documentElement.lang).toBe('en');
      expect(TestBed.inject(SessionService).session()).toMatchObject({ username: 'anna' });
      expect(update.start).toHaveBeenCalledOnce();
      // the first sync is underway, and nothing waited for it
      await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    } finally {
      TestBed.inject(SyncService).stop();
      document.documentElement.style.colorScheme = '';
    }
  });
});
