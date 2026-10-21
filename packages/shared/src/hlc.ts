export type HlcState = { wall: number; counter: number };

export const HLC_PATTERN = /^\d{15}:\d{5}:[A-Za-z0-9-]{1,64}$/;

const MAX_COUNTER = 99999;

export function formatHlc(wall: number, counter: number, node: string): string {
  return `${String(wall).padStart(15, '0')}:${String(counter).padStart(5, '0')}:${node}`;
}

export function parseHlc(hlc: string): { wall: number; counter: number; node: string } {
  if (!HLC_PATTERN.test(hlc)) throw new Error(`invalid hlc: ${hlc}`);
  const [wall, counter, node] = hlc.split(':') as [string, string, string];
  return { wall: Number(wall), counter: Number(counter), node };
}

export const hlcWall = (hlc: string): number => parseHlc(hlc).wall;

function checked(wall: number, counter: number): HlcState {
  if (counter > MAX_COUNTER) throw new Error('hlc counter overflow');
  return { wall, counter };
}

export function hlcNow(state: HlcState, now: number, node: string): { hlc: string; state: HlcState } {
  const wall = Math.max(state.wall, now);
  const next = checked(wall, wall === state.wall ? state.counter + 1 : 0);
  return { hlc: formatHlc(next.wall, next.counter, node), state: next };
}

export function hlcReceive(state: HlcState, remoteHlc: string, now: number): HlcState {
  const remote = parseHlc(remoteHlc);
  const wall = Math.max(state.wall, remote.wall, now);
  const inLocal = wall === state.wall;
  const inRemote = wall === remote.wall;
  if (inLocal && inRemote) return checked(wall, Math.max(state.counter, remote.counter) + 1);
  if (inLocal) return checked(wall, state.counter + 1);
  if (inRemote) return checked(wall, remote.counter + 1);
  return { wall, counter: 0 };
}
