import { InjectionToken } from '@angular/core';

/** This page's origin, as the browser reached it: what invite links and the phone's QR code point at. */
export const ORIGIN = new InjectionToken<string>('ORIGIN', { factory: () => location.origin });

/** False over plain HTTP anywhere but localhost: no service worker there, and no Secure session cookie. */
export const SECURE_CONTEXT = new InjectionToken<boolean>('SECURE_CONTEXT', { factory: () => isSecureContext });

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The server's own address: another device can't open it. */
export const isLocalOrigin = (origin: string): boolean => LOCAL.has(new URL(origin).hostname);
