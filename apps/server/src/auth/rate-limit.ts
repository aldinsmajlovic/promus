const WINDOW_MS = 15 * 60_000;
const PER_USERNAME = 10;
const TOTAL = 100;

// Keyed by username, not IP: behind `tailscale serve` every request comes from 127.0.0.1.
// ponytail: in-memory per-process limiter, resets on restart; use a table if this ever runs multi-process
// ponytail: on a public server, failures against many usernames reach TOTAL and block new sign-ins for up to
// 15 minutes (signed-in devices keep syncing); add per-IP limits, behind a trusted X-Forwarded-For, if that bites
export function createLoginLimiter() {
  let failures: { key: string; at: number }[] = [];
  const prune = (now: number) => {
    failures = failures.filter((f) => f.at > now - WINDOW_MS);
  };
  return {
    blocked(usernameNorm: string, now: number): boolean {
      prune(now);
      return failures.length >= TOTAL || failures.filter((f) => f.key === usernameNorm).length >= PER_USERNAME;
    },
    fail(usernameNorm: string, now: number): void {
      prune(now);
      failures.push({ key: usernameNorm, at: now });
    },
    reset(usernameNorm: string): void {
      failures = failures.filter((f) => f.key !== usernameNorm);
    },
  };
}
