import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { QrCode } from './qr-code';

describe('QrCode', () => {
  it('draws the modules as one path, on white with a 4-module quiet zone', () => {
    const fixture = TestBed.createComponent(QrCode);
    fixture.componentRef.setInput('text', 'https://a.example');
    fixture.detectChanges();
    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg')!;
    // 17 bytes: version 2 at level M, 25 modules, plus 4 on each side
    expect(svg.getAttribute('viewBox')).toBe('0 0 33 33');
    expect(svg.querySelector('rect')?.getAttribute('fill')).toBe('#fff');
    const d = svg.querySelector('path')!.getAttribute('d')!;
    // the top-left finder pattern starts at the quiet zone's edge
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect(d.match(/M/g)!.length).toBeGreaterThan(200);
  });
});
