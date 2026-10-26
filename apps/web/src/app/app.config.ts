import {
  type ApplicationConfig,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withViewTransitions } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { LangService, provideI18n } from './core/i18n';
import { InstallService } from './core/install';
import { registerIcons } from './core/icons';
import { SessionService } from './core/session';
import { SyncService } from './core/sync.service';
import { ThemeService } from './core/theme';
import { UpdateService } from './core/update';

/** The first render needs only IndexedDB, never the network: sync starts in the background. */
export async function startup(): Promise<void> {
  const theme = inject(ThemeService);
  const lang = inject(LangService);
  const session = inject(SessionService);
  const update = inject(UpdateService);
  const sync = inject(SyncService);
  // before the first await: the browser offers installing once, early
  inject(InstallService).start();
  await Promise.all([theme.load(), lang.load(), session.load()]);
  update.start();
  // without a session it stays off the network
  sync.start();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withViewTransitions({ skipInitialTransition: true })),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideI18n(),
    provideAppInitializer(registerIcons),
    provideAppInitializer(startup),
  ],
};
