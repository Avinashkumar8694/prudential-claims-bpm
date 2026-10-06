import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID-shaped id: sortable by creation time, URL-safe. Good enough for this project's needs
 *  without pulling in a dependency. */
export function newId(): string {
  const time = Date.now();
  let timePart = '';
  let t = time;
  for (let i = 0; i < 10; i++) { timePart = CROCKFORD[t % 32] + timePart; t = Math.floor(t / 32); }
  const rand = randomBytes(10);
  let randPart = '';
  for (const b of rand) randPart += CROCKFORD[b % 32];
  return (timePart + randPart).slice(0, 26);
}

/** A deterministic clock for tests — starts at `iso` and advances only when `.advance(ms)` is called,
 *  so time-sensitive engine behavior (timers, dueAt) is fully controllable and reproducible. */
export function fakeClock(iso = '2025-01-01T00:00:00.000Z') {
  let current = Date.parse(iso);
  return {
    clock: () => new Date(current).toISOString(),
    advance: (ms: number) => { current += ms; },
    set: (newIso: string) => { current = Date.parse(newIso); },
  };
}
