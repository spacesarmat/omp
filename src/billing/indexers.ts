/**
 * Paid Jackett / JacRed on the OMP VPS.
 * API keys and Basic auth live only on the billing server; the phone uses /v1/search and /v1/torrent.
 */

export type OmpIndexerSource = 'jackett' | 'jacred';
