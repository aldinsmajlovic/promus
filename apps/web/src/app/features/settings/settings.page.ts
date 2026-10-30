import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import { AuthError, NetworkError, type Release } from '@promus/shared';
import { version } from '../../../../../../package.json';
import { Actions } from '../../core/actions';
import { ApiClient } from '../../core/api';
import { injectBack } from '../../core/back';
import { updateGuideUrl } from '../../core/docs';
import { Household } from '../../core/household';
import { type Lang, LangService } from '../../core/i18n';
import { SessionService } from '../../core/session';
import { syncBadge } from '../../core/sync-badge';
import { SyncService } from '../../core/sync.service';
import { type ThemeMode, ThemeService } from '../../core/theme';
import { Face } from '../../shared/face';
import { PhoneCard } from '../../shared/phone-card';
import { injectInvite } from './invite-sheet';

@Component({
  selector: 'app-settings-page',
  imports: [
    MatIconButton,
    MatIcon,
    MatMenu,
    MatMenuItem,
    MatMenuTrigger,
    RouterLink,
    TranslocoDirective,
    Face,
    PhoneCard,
  ],
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  private readonly actions = inject(Actions);
  private readonly api = inject(ApiClient);
  private readonly sync = inject(SyncService);
  private readonly household = inject(Household);
  private readonly transloco = inject(TranslocoService);
  private readonly activeLang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  protected readonly lang = inject(LangService);
  protected readonly theme = inject(ThemeService);
  protected readonly user = inject(SessionService).session;
  protected readonly you = this.household.you;
  protected readonly badge = computed(() => syncBadge(this.sync.status()));
  /** You first, then the others; "You and maja". */
  protected readonly faces = computed(() => {
    const { members, you } = this.household;
    return [...members().filter((m) => m.id === you()), ...this.household.others()];
  });
  protected readonly names = computed(() => {
    const you = this.household.you();
    const names = this.faces().map((m) => (m.id === you ? this.transloco.translate('settings.you') : m.username));
    return new Intl.ListFormat(this.activeLang(), { type: 'conjunction' }).format(names);
  });
  protected readonly version = version;
  /** The releases after the server's, newest first: the update notice shows when there's one. */
  protected readonly releases = signal<Release[]>([]);
  protected readonly notes = computed(() => this.releases().flatMap((r) => r.notes[this.activeLang() === 'sv' ? 'sv' : 'en']));
  protected readonly updateGuide = updateGuideUrl;
  protected readonly back = injectBack();
  protected readonly invite = injectInvite();
  protected readonly langs: { value: Lang | 'system'; label: string }[] = [
    { value: 'system', label: 'settings.system' },
    { value: 'sv', label: 'settings.sv' },
    { value: 'en', label: 'settings.en' },
  ];
  protected readonly themes: { value: ThemeMode; label: string }[] = [
    { value: 'system', label: 'settings.system' },
    { value: 'light', label: 'settings.light' },
    { value: 'dark', label: 'settings.dark' },
  ];

  constructor() {
    void this.household.refresh();
    this.api.releases().then(
      (releases) => this.releases.set(releases),
      (err: unknown) => {
        // offline or signed out (the badge on your initial says so): no notice
        if (!(err instanceof NetworkError || err instanceof AuthError)) console.error('releases failed', err);
      },
    );
  }

  protected labelOf(options: { value: string; label: string }[], value: string): string {
    return options.find((o) => o.value === value)?.label ?? '';
  }

  protected setLang(pref: Lang | 'system'): void {
    this.lang.set(pref).catch((err: unknown) => this.actions.failed(err));
  }

  protected setTheme(mode: ThemeMode): void {
    this.theme.set(mode).catch((err: unknown) => this.actions.failed(err));
  }
}
