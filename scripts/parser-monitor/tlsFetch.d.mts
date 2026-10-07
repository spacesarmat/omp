export const EXTRA_CA_HOSTS: string[];
export function needsExtraCa(host: string): boolean;
export function monitorFetch(url: string, init?: RequestInit): Promise<Response>;
