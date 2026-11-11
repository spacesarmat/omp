// Billing calls from webOS, where the Android search transport is absent. XHR only, no tokens in the URL.
import type { HttpOptions, HttpResponse, SourceContext, SourceHttp } from '../sources/types';

function xhr(method: string, url: string, body: string | null, opts?: HttpOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.timeout = opts && opts.timeoutMs ? opts.timeoutMs : 12000;
    const headers = (opts && opts.headers) || {};
    const names = Object.keys(headers);
    for (let i = 0; i < names.length; i++) x.setRequestHeader(names[i], headers[names[i]]);
    if (body !== null) x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onload = () => resolve({ status: x.status, url: url, text: x.responseText || '' });
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(body);
  });
}

function encodeForm(form: { [key: string]: string }): string {
  const keys = Object.keys(form);
  const parts: string[] = [];
  for (let i = 0; i < keys.length; i++) parts.push(encodeURIComponent(keys[i]) + '=' + encodeURIComponent(form[keys[i]]));
  return parts.join('&');
}

export function webBillingHttp(): SourceHttp {
  return {
    get: (url, opts) => xhr('GET', url, null, opts),
    post: (url, form, opts) => xhr('POST', url, encodeForm(form), opts),
    clearCookies: () => Promise.resolve(),
  };
}

/** Same TorrServer client, but billing HTTP that works in the TV browser. */
export function webBillingContext(base: SourceContext): SourceContext {
  return { http: webBillingHttp(), client: base.client, secrets: base.secrets };
}
