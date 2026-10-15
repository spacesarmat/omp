// Built-in Jackett and JacRed on the OMP VPS. The subscription screen does not ask for these keys.
export const OMP_INDEXER_USER = 'omp';
export const OMP_INDEXER_PASS = 'sYxOt3U2uWMhXe8q1zoR';

export const OMP_JACKETT = {
  url: 'https://jackett.omp-player.online',
  apiKey: '0xpq0gg1ucp7ew7aadxyhanjr049ywpn',
};

export const OMP_JACRED = {
  url: 'https://jacred.omp-player.online',
  apiKey: 'cce311937e9070332afd58d5125ad6cb94ee6a96d40a45bd',
};

export function indexerAuthHeader(): string {
  return 'Basic ' + btoa(OMP_INDEXER_USER + ':' + OMP_INDEXER_PASS);
}
