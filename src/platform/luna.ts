declare global {
  interface Window {
    PalmServiceBridge?: new () => {
      onservicecallback: (msg: string) => void;
      call: (uri: string, params: string) => void;
    };
  }
}

export function hasLuna(): boolean {
  return typeof window !== 'undefined' && typeof window.PalmServiceBridge === 'function';
}

export function lunaCall<T = any>(uri: string, params: object = {}, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!hasLuna()) {
      reject(new Error('Luna unavailable'));
      return;
    }
    const bridge = new window.PalmServiceBridge!();
    const timer = setTimeout(() => reject(new Error('Luna timeout')), timeoutMs);
    bridge.onservicecallback = (msg: string) => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(msg);
        if (r.returnValue === false) reject(new Error(r.errorText || 'Luna error'));
        else resolve(r as T);
      } catch (e) {
        reject(e);
      }
    };
    bridge.call(uri, JSON.stringify(params));
  });
}

/** Subscription call: onMessage for every successful reply, onError once (then silent). */
export function lunaSubscribe(uri: string, params: object, onMessage: (msg: any) => void, onError: (e: Error) => void): () => void {
  if (!hasLuna()) {
    onError(new Error('Luna unavailable'));
    return () => undefined;
  }
  const bridge = new window.PalmServiceBridge!() as { onservicecallback: (msg: string) => void; call: (uri: string, params: string) => void; cancel?: () => void };
  let active = true;
  bridge.onservicecallback = (raw: string) => {
    if (!active) return;
    let r: any;
    try {
      r = JSON.parse(raw);
    } catch (e) {
      active = false;
      onError(new Error('Luna: bad reply'));
      return;
    }
    if (r.returnValue === false) {
      active = false;
      onError(new Error(r.errorText || 'Luna error'));
      return;
    }
    onMessage(r);
  };
  bridge.call(uri, JSON.stringify({ ...params, subscribe: true }));
  return () => {
    active = false;
    if (typeof bridge.cancel === 'function') bridge.cancel();
  };
}
