export const REPO_URL: string;
export const CAPTION_MAX: number;
export const UPLOAD_MAX: number;
export function escapeHtml(s: string): string;
export function buildCaption(version: string, notes: string[]): string;
export function buildKeyboard(p: { tag: string; version: string; donateUrl?: string }): {
  inline_keyboard: { text: string; url: string }[][];
};
