export const ASSET_NAME: string;
export function parseVersionFile(text: string): string;
export function pickAsset(release: { assets?: Array<{ name: string; digest?: string; browser_download_url?: string }> }): { name: string; digest?: string; browser_download_url?: string };
export function parseDigest(digest: unknown): string;
