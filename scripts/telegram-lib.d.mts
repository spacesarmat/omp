export const REPO_URL: string;
export const CAPTION_MAX: number;
export function escapeHtml(s: string): string;
export const CAPTION_NOTES_MAX: number;
export const CAPTION_FALLBACK: string;
export function buildCaption(version: string, notes: string[]): string;
export function buildFiles(version: string): string[];
export function downloadUrl(tag: string, name: string): string;
export function buildKeyboard(p: { tag: string; version: string; donateUrl?: string }): {
  inline_keyboard: { text: string; url: string }[][];
};
