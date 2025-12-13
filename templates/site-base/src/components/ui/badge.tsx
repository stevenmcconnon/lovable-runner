import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

type BadgeProps = {
  children: ReactNode;
  className?: string;
};

export const Badge = ({ children, className }: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border border-[hsl(var(--surface-foreground)/0.2)] bg-[hsl(var(--surface-foreground)/0.05)] px-3 py-1 text-xs font-medium uppercase tracking-wide text-[hsl(var(--surface-foreground)/0.85)]',
      className
    )}
  >
    {children}
  </span>
);
