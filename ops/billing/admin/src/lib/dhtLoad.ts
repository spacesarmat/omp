/** Ignores a slow /admin/api/dht reply once a newer load has started. */
export function createLoadGate() {
  let current = 0;
  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(id: number) {
      return id === current;
    },
  };
}
