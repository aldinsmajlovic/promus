import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatButtonHarness } from '@angular/material/button/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it, vi } from 'vitest';
import en from '../../i18n/en.json';
import { InstallService } from '../core/install';
import { ORIGIN } from '../core/platform';
import { PhoneCard } from './phone-card';

async function setup(origin: string, install: { canPrompt?: boolean; installed?: boolean; platform?: 'ios' | 'other' } = {}) {
  const prompt = vi.fn(async () => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: ORIGIN, useValue: origin },
      {
        provide: InstallService,
        useValue: {
          canPrompt: signal(install.canPrompt ?? false),
          installed: signal(install.installed ?? false),
          platform: install.platform ?? 'other',
          prompt,
        },
      },
      importProvidersFrom(
        TranslocoTestingModule.forRoot({ langs: { en }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' } }),
      ),
    ],
  });
  const fixture = TestBed.createComponent(PhoneCard);
  fixture.detectChanges();
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  return { el, prompt, loader: TestbedHarnessEnvironment.loader(fixture) };
}

describe('PhoneCard', () => {
  it('on localhost, explains instead of showing a code the phone could not open', async () => {
    const { el } = await setup('http://localhost:4200');
    expect(el.querySelector('svg')).toBeNull();
    expect(el.textContent).toContain(en.phone.local);
    const link = el.querySelector('a')!;
    expect(link.href).toMatch(/^https:\/\/github\.com\/aldinsmajlovic\/promus\/blob\/v[\d.]+\/docs\/self-hosting\.md#put-https-in-front$/);
  });

  for (const local of ['http://127.0.0.1:8080', 'http://[::1]:8080']) {
    it(`treats ${local} as local`, async () => {
      const { el } = await setup(local);
      expect(el.querySelector('svg')).toBeNull();
    });
  }

  it('shows the address as a QR code and as text', async () => {
    const { el } = await setup('https://x.example');
    expect(el.querySelector('svg')).not.toBeNull();
    expect(el.textContent).toContain('https://x.example');
    expect(el.textContent).toContain(en.install.other);
  });

  it('tells iPhone users how to add it to the home screen', async () => {
    const { el } = await setup('https://x.example', { platform: 'ios' });
    expect(el.textContent).toContain(en.install.ios);
    // a Home Screen app on iOS keeps its own cookies, apart from Safari's
    expect(el.textContent).toMatch(/sign in again/);
  });

  it('offers the browser install prompt where there is one', async () => {
    const { prompt, loader } = await setup('https://x.example', { canPrompt: true });
    await (await loader.getHarness(MatButtonHarness.with({ text: en.install.button }))).click();
    expect(prompt).toHaveBeenCalledOnce();
  });

  it('says nothing about installing once installed', async () => {
    const { el } = await setup('https://x.example', { installed: true });
    expect(el.textContent).not.toContain(en.install.other);
  });
});
