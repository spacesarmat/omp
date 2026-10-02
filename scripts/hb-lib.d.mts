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
