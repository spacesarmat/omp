export const ASSET_NAME: string;
export function parseVersionFile(text: string): string;
export function pickAsset(release: { assets?: Array<{ name: string; digest?: string; browser_download_url?: string; size?: number }> }): { name: string; digest?: string; browser_download_url?: string; size?: number };
export function parseDigest(digest: unknown): string;
export function bumpPatch(version: string): string;
export function insertChangelog(text: string, version: string, tag: string): string;
export function setRootVersion(text: string, version: string, lock?: boolean): string;
export const PIN_PATH: string;
export const LEGACY_LIB: string;
export interface TorrServerPin {
  tag: string;
  asset: string;
  url: string;
  sha256: string;
  size: number;
}
export function pinFromRelease(release: unknown, tag: string): TorrServerPin;
export function checkPin(p: unknown): TorrServerPin;
export function formatPin(p: TorrServerPin): string;
export function parsePin(text: string, tag: string): TorrServerPin;
