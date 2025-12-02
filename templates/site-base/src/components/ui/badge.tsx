import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

type BadgeProps = {
  children: ReactNode;
  className?: string;
};

export const Badge = ({ children, className }: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-wide text-white/80',
      className
    )}
  >
    {children}
  </span>
);
