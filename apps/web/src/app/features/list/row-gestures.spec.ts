import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RowGestures } from './row-gestures';

@Component({
  imports: [RowGestures],
  template: `<button
    appRowGestures
    [swipe]="swipe"
    (click)="clicks = clicks + 1"
    (held)="held = held + 1"
    (swiped)="swiped = swiped + 1"
  >
    Milk
  </button>`,
})
class Host {
  swipe = true;
  clicks = 0;
  held = 0;
  swiped = 0;
}

function setup(swipe = true) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.swipe = swipe;
  fixture.detectChanges();
  const host = fixture.componentInstance;
  const el: HTMLButtonElement = fixture.nativeElement.querySelector('button');
  Object.defineProperty(el, 'offsetWidth', { value: 360 });
  const fire = (type: string, x = 0, y = 0) =>
    el.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, button: 0, bubbles: true }));
  // the click a browser sends after pointerup
  const click = () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return { host, el, fire, click };
}

describe('RowGestures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });
  afterEach(() => vi.useRealTimers());

  it('a still hold of 480 ms is held, and its click does nothing', () => {
    const { host, fire, click } = setup();
    fire('pointerdown', 10, 10);
    vi.advanceTimersByTime(479);
    expect(host.held).toBe(0);
    vi.advanceTimersByTime(1);
    expect(host.held).toBe(1);
    fire('pointerup', 10, 10);
    click();
    expect(host.clicks).toBe(0);
  });

  it('moving past 8px before 480 ms is no hold', () => {
    const { host, fire } = setup();
    fire('pointerdown', 10, 10);
    fire('pointermove', 20, 10);
    vi.advanceTimersByTime(600);
    expect(host.held).toBe(0);
  });

  it('a vertical drag scrolls: no hold, no swipe', () => {
    const { host, el, fire } = setup();
    fire('pointerdown', 100, 10);
    fire('pointermove', 105, 40);
    fire('pointermove', 60, 80);
    fire('pointerup', 60, 80);
    vi.advanceTimersByTime(600);
    expect(host.held).toBe(0);
    expect(host.swiped).toBe(0);
    expect(el.style.translate).toBe('');
  });

  it('a left swipe past 110px is swiped, and its click does nothing', () => {
    const { host, el, fire, click } = setup();
    fire('pointerdown', 200, 10);
    fire('pointermove', 80, 12);
    expect(el.classList).toContain('swiping');
    expect(el.style.translate).toBe('-120px');
    fire('pointerup', 80, 12);
    click();
    expect(host.swiped).toBe(1);
    expect(host.clicks).toBe(0);
  });

  it('a short swipe springs back', () => {
    const { host, el, fire } = setup();
    fire('pointerdown', 200, 10);
    fire('pointermove', 140, 10);
    fire('pointerup', 140, 10);
    expect(host.swiped).toBe(0);
    expect(el.style.translate).toBe('');
    expect(el.classList).toContain('snap');
    expect(el.classList).not.toContain('swiping');
  });

  it('a right swipe does nothing', () => {
    const { host, el, fire } = setup();
    fire('pointerdown', 10, 10);
    fire('pointermove', 160, 10);
    fire('pointerup', 160, 10);
    expect(host.swiped).toBe(0);
    expect(el.style.translate).toBe('');
  });

  it('right-click or the context-menu key is held once, default prevented', () => {
    const { host, el, fire } = setup();
    const menu = () => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(menu()).toBe(true);
    expect(host.held).toBe(1);
    // Android: a long touch holds, then also sends contextmenu
    fire('pointerdown', 10, 10);
    vi.advanceTimersByTime(480);
    expect(menu()).toBe(true);
    fire('pointerup', 10, 10);
    expect(host.held).toBe(2);
  });

  it('contextmenu without a press is held every time', () => {
    const { host, el } = setup();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(host.held).toBe(2);
  });

  it('after a hold, moving left is not a swipe', () => {
    const { host, el, fire } = setup();
    fire('pointerdown', 200, 10);
    vi.advanceTimersByTime(480);
    fire('pointermove', 60, 10);
    fire('pointerup', 60, 10);
    expect(host.held).toBe(1);
    expect(host.swiped).toBe(0);
    expect(el.style.translate).toBe('');
  });

  it('pointercancel resets a swipe', () => {
    const { host, el, fire } = setup();
    fire('pointerdown', 200, 10);
    fire('pointermove', 60, 10);
    fire('pointercancel', 60, 10);
    fire('pointerup', 60, 10);
    expect(host.swiped).toBe(0);
    expect(el.style.translate).toBe('');
    expect(el.classList).not.toContain('swiping');
  });

  it('with swipe off, a left drag does nothing', () => {
    const { host, el, fire } = setup(false);
    fire('pointerdown', 200, 10);
    fire('pointermove', 80, 10);
    fire('pointerup', 80, 10);
    expect(host.swiped).toBe(0);
    expect(el.style.translate).toBe('');
  });

  it('a plain tap still clicks', () => {
    const { host, fire, click } = setup();
    fire('pointerdown', 10, 10);
    vi.advanceTimersByTime(100);
    fire('pointerup', 10, 10);
    click();
    expect(host.clicks).toBe(1);
    expect(host.held).toBe(0);
  });
});
