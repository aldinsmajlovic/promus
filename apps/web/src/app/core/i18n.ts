import { DOCUMENT, Injectable, inject, isDevMode, provideAppInitializer } from '@angular/core';
import {
  provideTransloco,
  type Translation,
  type TranslocoLoader,
  TranslocoService,
} from '@jsverse/transloco';

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

@Injectable()
class BundledLoader implements TranslocoLoader {
  getTranslation(lang: string) {
    return TRANSLATIONS[lang as Lang]().then((m) => m.default);
  }
}

export function provideI18n() {
  return [
    ...provideTransloco({
      config: {
        availableLangs: ['sv', 'en'],
        defaultLang: detectLang(navigator.languages),
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: BundledLoader,
    }),
    provideAppInitializer(() => {
      const html = inject(DOCUMENT).documentElement;
      const transloco = inject(TranslocoService);
      transloco.langChanges$.subscribe((lang) => (html.lang = lang));
      return transloco.load(transloco.getActiveLang());
    }),
  ];
}
