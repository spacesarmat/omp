export function postRelease(p: {
  tag: string;
  dir?: string;
  root?: string;
  token: string;
  chat: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}): Promise<number>;
