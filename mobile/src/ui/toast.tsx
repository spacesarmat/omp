import { signal } from '@preact/signals';

export const toast = signal('');
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, ms = 3000): void {
  toast.value = text;
  clearTimeout(timer);
  timer = setTimeout(() => (toast.value = ''), ms);
}

export function Toast() {
  const text = toast.value;
  return (
    <div class="m-toast-host" role="status" aria-live="polite">
      {text && <div class="m-toast">{text}</div>}
    </div>
  );
}
