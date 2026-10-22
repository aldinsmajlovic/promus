import { Injectable, computed, signal } from '@angular/core';

/** Chrome's install prompt, kept for a button of our own. Not in the DOM typings. */
type InstallPromptEvent = Event & { prompt(): Promise<void> };

const standalone = (): boolean =>
  globalThis.matchMedia?.('(display-mode: standalone)').matches === true ||
  (navigator as { standalone?: boolean }).standalone === true;

// iPadOS reports itself as a Mac, but a Mac has no touch screen
const ios = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Installing the app on this device: the browser's own prompt where there is one, instructions otherwise. */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private readonly deferred = signal<InstallPromptEvent | null>(null);
  readonly canPrompt = computed(() => this.deferred() !== null);
  readonly installed = signal(standalone());
  /** Which instructions fit where the browser has no prompt. */
  readonly platform: 'ios' | 'other' = ios() ? 'ios' : 'other';

  /** At app start: Chrome fires the event once, early. */
  start(): void {
    addEventListener('beforeinstallprompt', (event) => {
      // keeps it for our button instead of Chrome's own banner
      event.preventDefault();
      this.deferred.set(event as InstallPromptEvent);
    });
    addEventListener('appinstalled', () => {
      this.deferred.set(null);
      this.installed.set(true);
    });
  }

  async prompt(): Promise<void> {
    const event = this.deferred();
    // an event prompts once
    this.deferred.set(null);
    await event?.prompt();
  }
}
