export const ALBUM_MAX: number;
export const BUTTONS_TEXT: string;
export const WEBHOOK_NOTICE_LOG: string;
export function postRelease(p: {
  tag: string;
  dir?: string;
  root?: string;
  token: string;
  chat: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  pause?: (ms: number) => Promise<void>;
}): Promise<number>;
export function replacePhoto(p: {
  tag: string;
  messageId: number;
  root?: string;
  token: string;
  chat: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  pause?: (ms: number) => Promise<void>;
}): Promise<void>;
export function repostFiles(p: {
  tag: string;
  messageId: number;
  deleteIds?: number[];
  dir?: string;
  token: string;
  chat: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}): Promise<number>;
