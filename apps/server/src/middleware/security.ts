import { secureHeaders } from 'hono/secure-headers';

export const security = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    frameAncestors: ["'none'"],
  },
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'same-origin',
});
