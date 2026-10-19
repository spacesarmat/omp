import { useState } from 'react';
import { clock, exactStamp, listStamp } from '@/lib/time';

/** Visible clock or date+time. Hover and tap show the full Moscow stamp with seconds. */
export function Stamp({
  ms,
  variant = 'datetime',
  toggle = true,
}: {
  ms?: number;
  variant?: 'time' | 'datetime';
  toggle?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!ms) return <span className="text-muted-foreground">-</span>;
  const full = exactStamp(ms);
  const short = variant === 'time' ? clock(ms) : listStamp(ms) + ' МСК';
  const shown = open && toggle ? full : short;
  if (!toggle) {
    return (
      <time dateTime={new Date(ms).toISOString()} title={full} className="whitespace-nowrap">
        {short}
      </time>
    );
  }
  return (
    <button
      type="button"
      className="inline whitespace-nowrap rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      title={full}
      aria-label={full}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((v) => !v);
      }}
    >
      <time dateTime={new Date(ms).toISOString()}>{shown}</time>
    </button>
  );
}
