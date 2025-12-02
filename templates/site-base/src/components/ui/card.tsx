import { cn } from '../../lib/cn';
import type { ReactNode } from 'react';

type CardProps = {
  children: ReactNode;
  className?: string;
};

export const Card = ({ children, className }: CardProps) => (
  <div className={cn('rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-6 text-white shadow-xl', className)}>
    {children}
  </div>
);
