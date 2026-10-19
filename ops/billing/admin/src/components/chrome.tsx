import type { FormEvent, ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Flash } from '@/lib/api';

export function toast(text: string) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  window.clearTimeout((el as HTMLElement & { _t?: number })._t);
  (el as HTMLElement & { _t?: number })._t = window.setTimeout(() => {
    el.style.display = 'none';
  }, 2200);
}

export function Toast() {
  return (
    <div
      id="toast"
      className="fixed bottom-6 left-1/2 z-50 hidden max-w-md -translate-x-1/2 rounded-md bg-primary px-4 py-2 text-center font-bold text-zinc-950"
    />
  );
}

export function CopyBtn({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="ml-1 h-7 px-2 text-xs"
      onClick={() => void navigator.clipboard.writeText(value).then(() => toast('Скопировано'))}
    >
      Копировать
    </Button>
  );
}

export function Alerts({ a }: { a: { level: string; text: string; accountId?: string } }) {
  return (
    <Alert variant={a.level === 'bad' ? 'destructive' : 'warn'}>
      {a.accountId ? (
        <a className="underline underline-offset-2 hover:opacity-90" href={'/admin/?id=' + encodeURIComponent(a.accountId)}>
          {a.text}
        </a>
      ) : (
        a.text
      )}
    </Alert>
  );
}

export function FlashBox({ flash }: { flash?: Flash }) {
  if (!flash) return null;
  if (flash.error) return <Alert variant="destructive">{flash.error}</Alert>;
  if (flash.code)
    return (
      <Alert variant="success">
        Код: <code className="font-mono tracking-wider">{flash.code}</code> <CopyBtn value={flash.code} />
      </Alert>
    );
  if (flash.promo)
    return (
      <Alert variant="success">
        Промо: <code className="font-mono">{flash.promo}</code> <CopyBtn value={flash.promo} />
      </Alert>
    );
  if (flash.text) return <Alert>{flash.text}</Alert>;
  return null;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={'animate-pulse rounded-md bg-zinc-800 ' + (className || 'h-8 w-full')} />;
}

export function LoadingScreen() {
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
      <Skeleton className="h-10 w-48" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-40" />
    </main>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={className} aria-hidden="true">
      <rect x="0" y="0" width="100" height="100" rx="20" fill="#181B22" />
      <g transform="translate(9 9) scale(0.82)">
        <rect x="14" y="22" width="72" height="56" rx="10" fill="none" stroke="#F5B700" strokeWidth="7" />
        <path d="M44 41 L59 50 L44 59 Z" fill="#E8EAF0" stroke="#E8EAF0" strokeWidth="4" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Logo className="h-10 w-10 shrink-0" />
      <h1 className="text-2xl font-bold leading-none">OMP Billing</h1>
    </div>
  );
}

export function SubStatus({ status }: { status: string }) {
  if (status === 'expired') return <Badge variant="bad">истекла</Badge>;
  if (status === 'grace') return <Badge variant="warn">льготный период</Badge>;
  if (status === 'expiring') return <Badge variant="warn">истекает</Badge>;
  if (status === 'soon') return <Badge variant="warn">до 7 дней</Badge>;
  if (status === 'unbound') return <Badge variant="secondary">без устройства</Badge>;
  return <Badge variant="ok">активна</Badge>;
}

export function Devices({ bound, limit, over }: { bound: number; limit: number; over?: boolean }) {
  const warn = over || bound > limit;
  return (
    <span className={warn ? 'font-medium text-amber-200' : ''}>
      {bound}/{limit}
      {warn ? ' · сверх лимита' : ''}
    </span>
  );
}

export function Pager({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (n: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {total} · стр. {page} из {pages}
      </span>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Назад
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Дальше
        </Button>
      </div>
    </div>
  );
}

export function DayChart({
  rows,
  field,
  label,
}: {
  rows: { day: string; revenue: number; subs: number }[];
  field: 'revenue' | 'subs';
  label: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r[field]));
  return (
    <div>
      <div className="mb-2 text-sm text-muted-foreground">{label}</div>
      <div className="flex h-36 items-end gap-px overflow-x-auto">
        {rows.map((r) => (
          <div key={r.day} title={r.day + ': ' + r[field]} className="flex h-full min-w-[6px] flex-1 flex-col justify-end">
            <div
              className="w-full rounded-sm bg-[#f5b700]"
              style={{ height: Math.max(2, Math.round((r[field] / max) * 128)) + 'px' }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>{rows[0]?.day || ''}</span>
        <span>{rows[rows.length - 1]?.day || ''}</span>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function onSubmit(fn: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    fn();
  };
}
