// Built-in Jackett and JacRed on the OMP VPS. The subscription screen does not ask for these keys.
export const OMP_INDEXER_USER = 'omp';
export const OMP_INDEXER_PASS = 'sYxOt3U2uWMhXe8q1zoR';

export const OMP_JACKETT = {
  url: 'https://jackett.omp-player.online',
  apiKey: 'czcnyyyau0egr3ybk92i8rvuftoq1uem',
};

export const OMP_JACRED = {
  url: 'https://jacred.omp-player.online',
  apiKey: '477c3f65e3a839d14978ff6250b4070591d424b159622416',
};

export function indexerAuthHeader(): string {
  return 'Basic ' + btoa(OMP_INDEXER_USER + ':' + OMP_INDEXER_PASS);
}
