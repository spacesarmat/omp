/** Smallest friend-count that is not already used, so a new tier does not replace a saved one. */
export function nextTierFriends(friends: number[]): number {
  const used = new Set(friends);
  let n = 1;
  while (used.has(n) && n < 10000) n += 1;
  return n;
}
