export const REPO: string;
export const REPO_URL: string;
export const HOMEBREW_REPO_URL: string;
export const RELEASE_NOTES_MAX: number;
export function previousVersion(md: string, version: string): string | null;
export function buildReleaseNotes(p: {
  tag: string;
  version: string;
  ru: string[];
  en: string[];
  prevTag?: string | null;
  sha256?: { name: string; sha: string }[];
}): string;
