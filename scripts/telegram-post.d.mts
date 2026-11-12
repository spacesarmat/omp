export const ALBUM_MAX: number;
export const BUTTONS_TEXT: string;
export function postNotice(p: {
  text: string;
  tag: string;
  token: string;
  chat: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}): Promise<number>;
export function postRelease(p: {
  tag: string;
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
