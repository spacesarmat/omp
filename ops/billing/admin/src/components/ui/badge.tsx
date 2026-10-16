import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600',
      secondary: 'bg-zinc-800 text-zinc-100 ring-1 ring-zinc-600',
      count: 'bg-zinc-950 text-zinc-50 ring-1 ring-zinc-500',
      ok: 'bg-emerald-950 text-emerald-300 ring-1 ring-emerald-800',
      bad: 'bg-red-950 text-red-200 ring-1 ring-red-800',
      warn: 'bg-amber-950 text-amber-200 ring-1 ring-amber-700',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
