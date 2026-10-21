import { ApplicationInitStatus } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TRANSLOCO_LOADER, TranslocoService } from '@jsverse/transloco';
import { normalizeName } from '@promus/shared';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/en.json';
import sv from '../../i18n/sv.json';
import { detectLang, provideI18n } from './i18n';

const keyPaths = (obj: object, prefix = ''): string[] =>
  Object.entries(obj)
    .flatMap(([k, v]) => (typeof v === 'object' ? keyPaths(v, `${prefix}${k}.`) : [prefix + k]))
    .sort();

describe('i18n', () => {
  it('detectLang picks sv for Swedish browsers', () => {
    expect(detectLang(['sv-SE', 'en'])).toBe('sv');
    expect(detectLang(['en-US', 'sv'])).toBe('en');
    expect(detectLang(['de-DE'])).toBe('en');
  });

  it('sv and en translations have the same keys', () => {
    expect(keyPaths(sv)).toEqual(keyPaths(en));
  });

  it('preloads the browser language and mirrors it to the html lang', async () => {
    const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['sv-SE']);
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    languages.mockRestore();
    await TestBed.inject(ApplicationInitStatus).donePromise;
    expect(document.documentElement.lang).toBe('sv');
    expect(TestBed.inject(TranslocoService).translate('update.reload')).toBe('Ladda om');
  });

  it('rejects languages it has no translations for', async () => {
    TestBed.configureTestingModule({ providers: [provideI18n()] });
    await expect(TestBed.inject(TRANSLOCO_LOADER).getTranslation('de')).rejects.toThrow('"de"');
  });

  it('resolves @promus/shared from source', () => {
    expect(normalizeName(' Mjölk ')).toBe('mjölk');
  });
});
