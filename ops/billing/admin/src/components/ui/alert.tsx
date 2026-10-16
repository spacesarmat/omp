import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

const alertVariants = cva('relative w-full rounded-lg border px-3 py-2 text-sm', {
  variants: {
    variant: {
      default: 'border-border bg-secondary text-foreground',
      destructive: 'border-destructive/50 bg-red-950/40 text-red-200',
      warn: 'border-primary/40 bg-amber-950/30 text-amber-100',
      success: 'border-emerald-700/50 bg-emerald-950/30 text-emerald-100',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}
