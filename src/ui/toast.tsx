import { signal } from '@preact/signals';

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

const toasts = signal<ToastItem[]>([]);
let tid = 0;

export function toast(text: string, kind: 'info' | 'error' = 'info'): void {
  const id = ++tid;
  toasts.value = toasts.value.concat({ id, text, kind });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3500);
}

export function ToastHost() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => <div key={t.id} class={'toast toast-' + t.kind}>{t.text}</div>)}
    </div>
  );
}
