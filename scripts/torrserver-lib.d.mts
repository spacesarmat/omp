export const ASSET_NAME: string;
export function parseVersionFile(text: string): string;
export function pickAsset(release: { assets?: Array<{ name: string; digest?: string; browser_download_url?: string }> }): { name: string; digest?: string; browser_download_url?: string };
export function parseDigest(digest: unknown): string;
export function bumpPatch(version: string): string;
export function isNewerTag(current: string, latest: string): boolean;
export function insertChangelog(text: string, version: string, tag: string): string;
export function setRootVersion(text: string, version: string, lock?: boolean): string;
