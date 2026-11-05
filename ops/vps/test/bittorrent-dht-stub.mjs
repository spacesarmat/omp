// Resolvable stand-in so Vite can load lookup.mjs without ops/vps/dht-peers/node_modules.
// The DHT tests replace this module with vi.mock before importing the adapter.
export default class DHT {
  constructor() {
    throw new Error('bittorrent-dht must be mocked in tests');
  }
}
