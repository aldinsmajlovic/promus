import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { importProvidersFrom, provideAppInitializer, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { Person } from '@promus/shared';
import { describe, expect, it } from 'vitest';
import sv from '../../../i18n/sv.json';
import { Household } from '../../core/household';
import { registerIcons } from '../../core/icons';
import { PeopleMenu } from './people-menu';
import { untilDay } from './share-sheet';

const anna: Person = { id: 'u1', name: 'anna', guest: false };
const bo: Person = { id: 'u2', name: 'bo', guest: false };
const felix: Person = { id: 'g1', name: 'Felix', guest: true };
const nameless: Person = { id: 'g2', name: null, guest: true };
const cia: Person = { id: 'u3', name: 'cia', guest: false };

async function setup(people: Person[], until: number | null = null) {
  TestBed.configureTestingModule({
    providers: [
      // you are anna
      { provide: Household, useValue: { you: signal('u1') } },
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      provideAppInitializer(registerIcons),
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { sv },
          translocoConfig: { availableLangs: ['sv'], defaultLang: 'sv' },
          preloadLangs: true,
        }),
      ),
    ],
  });
  const fixture = TestBed.createComponent(PeopleMenu);
  fixture.componentRef.setInput('people', people);
  fixture.componentRef.setInput('until', until);
  fixture.componentRef.setInput('list', 'Tacokväll');
  await fixture.whenStable();
  const el: HTMLElement = fixture.nativeElement;
  return { el, loader: TestbedHarnessEnvironment.documentRootLoader(fixture) };
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
// each row's initial, name, and You or Guest
const rows = () =>
  [...document.querySelectorAll('.people-menu .person')].map((r) =>
    ['app-face', '.full-name', '.tag'].map((part) => text(r.querySelector(part))),
  );

describe('PeopleMenu', () => {
  it('"with" shows everyone but you, three at most, guests ringed, and its label names them', async () => {
    const { el } = await setup([felix, anna, bo, nameless, cia]);
    const faces = [...el.querySelectorAll('.with app-face')];
    expect(faces.map(text)).toEqual(['F', 'B', 'G']);
    expect(faces.map((f) => f.classList.contains('guest'))).toEqual([true, false, true]);
    expect(faces.every((f) => f.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(text(el.querySelector('.with'))).toContain('+1');
    expect(el.querySelector('.with')!.getAttribute('aria-label')).toBe('Delas med Felix, bo, Gäst och cia');
  });

  it('with only you, there is no "with"', async () => {
    const { el } = await setup([anna]);
    expect(el.querySelector('.with')).toBeNull();
  });

  it('tapping the faces lists everyone by full name, you first, and until when the link works', async () => {
    const until = Date.UTC(2026, 10, 9, 12);
    const { loader } = await setup([felix, bo, anna, nameless], until);
    const menu = await loader.getHarness(MatMenuHarness.with({ selector: '.with' }));
    await menu.open();
    const panel = document.querySelector('.people-menu')!;
    expect(text(panel.querySelector('.heading'))).toBe('På Tacokväll');
    expect(rows()).toEqual([
      ['A', 'anna', 'Du'],
      ['F', 'Felix', 'Gäst'],
      ['B', 'bo', ''],
      ['G', 'Gäst', 'Gäst'],
    ]);
    expect([...panel.querySelectorAll('.person app-face')].map((f) => f.classList.contains('guest'))).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(text(panel.querySelector('.until'))).toBe(`Länken fungerar till ${untilDay(until, 'sv')}`);
  });

  it('without a live link, the menu says nothing of one', async () => {
    const { loader } = await setup([anna, bo]);
    const menu = await loader.getHarness(MatMenuHarness.with({ selector: '.with' }));
    await menu.open();
    expect(rows()).toEqual([
      ['A', 'anna', 'Du'],
      ['B', 'bo', ''],
    ]);
    expect(document.querySelector('.people-menu .until')).toBeNull();
  });
});
