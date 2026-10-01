export type ApiErrorKind = 'network' | 'timeout' | 'http' | 'parse';

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
}

// Plain Error + fields: subclassing Error breaks instanceof after ES5 transpilation.
export function apiError(kind: ApiErrorKind, message: string, status?: number): Error & ApiError {
  const e = new Error(message) as Error & ApiError;
  e.kind = kind;
  if (status !== undefined) e.status = status;
  return e;
}

export function isApiError(e: unknown): e is ApiError {
  return !!e && typeof (e as ApiError).kind === 'string';
}

export function errorMessage(e: unknown): string {
  if (isApiError(e)) {
    switch (e.kind) {
      case 'network': return 'Сервер недоступен';
      case 'timeout': return 'Сервер не отвечает';
      case 'http': return 'Ошибка сервера (' + e.status + ')';
      case 'parse': return 'Некорректный ответ сервера';
    }
  }
  if (e && typeof (e as Error).message === 'string') return (e as Error).message;
  return 'Неизвестная ошибка';
}

export interface HttpOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  timeoutMs?: number;
  auth?: string;
  responseType?: 'json' | 'text' | 'arraybuffer';
}

export function request<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const headers: { [k: string]: string } = {};
  const hasBody = opts.body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (opts.auth) headers['Authorization'] = 'Basic ' + opts.auth;
  const type = opts.responseType || 'json';

  const p = fetch(url, {
    method: opts.method || (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  }).then(
    (res) => {
      if (!res.ok) throw apiError('http', 'HTTP ' + res.status, res.status);
      if (type === 'arraybuffer') {
        return res.arrayBuffer().then((buf) => buf as unknown as T);
      } else if (type === 'text') {
        return res.text().then((text) => text as unknown as T);
      } else {
        return res.text().then((text) => {
          if (!text) return null as unknown as T;
          try {
            return JSON.parse(text) as T;
          } catch (e) {
            throw apiError('parse', 'Bad JSON');
          }
        });
      }
    },
    () => {
      throw apiError('network', 'Network error');
    },
  );

  const timeout = opts.timeoutMs === undefined ? 5000 : opts.timeoutMs;
  if (timeout <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(apiError('timeout', 'Timeout')), timeout);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
