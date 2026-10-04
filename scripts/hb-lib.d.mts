export const APP_ID: string;
export const REPO: string;
export const FEED_BASE: string;
export function changelogNotes(md: string, version: string): string[];
export function buildHomebrew(p: {
  tag: string;
  version: string;
  ipkName: string;
  sha256: string;
  size: number;
  title: string;
  description: string;
  notes: string[];
}): { manifest: object; apps: object; update: object };
export const APK_ABIS: string[];
export function apkAbi(name: string): 'arm64' | 'armv7' | null;
export function splitApks(paths: string[]): { universal: string; abis: Partial<Record<'arm64' | 'armv7', string>> } | null;
export interface AbiApk {
  name: string;
  sha256: string;
  size: number;
}
export function buildAndroidUpdate(p: {
  tag: string;
  version: string;
  apkName: string;
  sha256: string;
  size: number;
  notes: string[];
  abis?: Partial<Record<'arm64' | 'armv7', AbiApk>>;
}): object;
