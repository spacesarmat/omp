export const APP_ID: string;
export const REPO: string;
export const FEED_BASE: string;
export const FIXES_NOTE: string;
export function changelogNotes(md: string, version: string, platform?: 'tv' | 'phone'): string[];
export function feedNotes(md: string, version: string): { notes: string[]; notesTv: string[]; notesPhone: string[] };
export function buildHomebrew(p: {
  tag: string;
  version: string;
  ipkName: string;
  sha256: string;
  size: number;
  title: string;
  description: string;
  notes: string[];
  notesTv?: string[];
  notesPhone?: string[];
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
  notesTv?: string[];
  notesPhone?: string[];
  abis?: Partial<Record<'arm64' | 'armv7', AbiApk>>;
}): object;
