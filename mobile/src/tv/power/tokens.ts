// Pairing tokens for network TVs and the IR learner. The phone keeps them in the Android keystore.
// A browser has no keystore: the token stays in memory for this tab and is not written to localStorage.
import { native } from '../../platform/native';

const mem = new Map<string, string>();

export async function saveNetToken(id: string, token: string): Promise<void> {
  mem.set(id, token);
  try {
    await native.secretSet('nettv:' + id, token);
  } catch {
    // the web build has no keystore
  }
}

export async function loadNetToken(id: string): Promise<string | null> {
  const hit = mem.get(id);
  if (hit) return hit;
  try {
    const value = await native.secretGet('nettv:' + id);
    if (value) mem.set(id, value);
    return value;
  } catch {
    return null;
  }
}
