import { DOCUMENT, Injectable, inject, isDevMode, signal } from '@angular/core';
import {
  provideTransloco,
  type Translation,
  type TranslocoLoader,
  TranslocoService,
} from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { PromusDb } from './db';

export type Lang = 'sv' | 'en';

const TRANSLATIONS: Record<Lang, () => Promise<{ default: Translation }>> = {
  sv: () => import('../../i18n/sv.json'),
  en: () => import('../../i18n/en.json'),
};

export function detectLang(languages: readonly string[]): Lang {
  for (const lang of languages) {
    if (lang.startsWith('sv')) return 'sv';
    if (lang.startsWith('en')) return 'en';
  }
  return 'en';
}

const isLang = (lang: string): lang is Lang => Object.hasOwn(TRANSLATIONS, lang);

@Injectable()
class BundledLoader implements TranslocoLoader {
  async getTranslation(lang: string): Promise<Translation> {
    if (!isLang(lang)) throw new Error(`No translations for "${lang}"`);
    return (await TRANSLATIONS[lang]()).default;
  }
}

export function provideI18n() {
  return provideTransloco({
    config: {
      availableLangs: ['sv', 'en'],
      defaultLang: detectLang(navigator.languages),
      fallbackLang: 'en',
      reRenderOnLangChange: true,
      prodMode: !isDevMode(),
    },
    loader: BundledLoader,
  });
}

/** The UI language, kept in meta `lang`; `system` follows the browser. */
@Injectable({ providedIn: 'root' })
export class LangService {
  private readonly db = inject(PromusDb);
  private readonly transloco = inject(TranslocoService);
  private readonly html = inject(DOCUMENT).documentElement;
  private readonly current = signal<Lang | 'system'>('system');
  readonly pref = this.current.asReadonly();

  /** Applies the saved language, translations loaded. */
  async load(): Promise<void> {
    await this.apply((await this.db.getMeta('lang')) ?? 'system');
  }

  /** Applies the language, then saves it. */
  async set(pref: Lang | 'system'): Promise<void> {
    await this.apply(pref);
    await this.db.setMeta('lang', pref);
  }

  private async apply(pref: Lang | 'system'): Promise<void> {
    this.current.set(pref);
    const lang = pref === 'system' ? detectLang(navigator.languages) : pref;
    // loaded first, so the page never shows keys in between
    await firstValueFrom(this.transloco.load(lang));
    this.transloco.setActiveLang(lang);
    this.html.lang = lang;
  }
}
