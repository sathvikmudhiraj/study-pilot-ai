export function measureIntent<T>(name: string, resolve: () => T): T {
  const startedAt = performance.now();
  const result = resolve();
  performance.measure(name, { start: startedAt, end: performance.now() });
  return result;
}
