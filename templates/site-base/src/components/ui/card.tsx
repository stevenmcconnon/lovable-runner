import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
};

export const Card = ({ children, className }: CardProps) => (
  <div
    className={cn(
      'rounded-2xl border border-[hsl(var(--surface-foreground)/0.12)] bg-[hsl(var(--brand)/0.08)] p-6 text-[hsl(var(--surface-foreground))] shadow-xl shadow-[hsl(var(--brand)/0.15)]/40 backdrop-blur-md',
      className
    )}
  >
    {children}
  </div>
);
