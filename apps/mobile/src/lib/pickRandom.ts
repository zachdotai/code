export function pickRandom<T>(pool: readonly T[]): T {
  if (pool.length === 0) throw new Error("pickRandom: pool must not be empty");
  return pool[Math.floor(Math.random() * pool.length)];
}
