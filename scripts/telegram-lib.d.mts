export const REPO_URL: string;
export const CAPTION_MAX: number;
export const UPLOAD_MAX: number;
export function escapeHtml(s: string): string;
export function buildCaption(version: string, notes: string[]): string;
export function buildFiles(version: string): string[];
export function routeFiles<T extends { size: number }>(files: T[]): { upload: T[]; link: T[] };
export function downloadUrl(tag: string, name: string): string;
export function buildLinksMessage(tag: string, files: { name: string }[]): string;
export function oversizeLogLine(file: { name: string; size: number }): string;
export function buildKeyboard(p: { tag: string; version: string; donateUrl?: string }): {
  inline_keyboard: { text: string; url: string }[][];
};
