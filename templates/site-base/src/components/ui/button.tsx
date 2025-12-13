import { cn } from '../../lib/cn';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'secondary' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const baseStyles =
  'inline-flex items-center justify-center rounded-full font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
const variants: Record<Variant, string> = {
  default: 'bg-[hsl(var(--brand))] text-[hsl(var(--on-brand-foreground))] shadow-lg hover:brightness-110 px-6 py-3',
  secondary:
    'bg-transparent border border-[hsl(var(--surface-foreground)/0.2)] text-[hsl(var(--surface-foreground))] px-6 py-3 hover:bg-[hsl(var(--surface-foreground)/0.08)]',
  ghost: 'bg-transparent text-[hsl(var(--surface-foreground))] hover:text-[hsl(var(--brand))] px-4 py-2',
};

export const Button = ({ variant = 'default', className, children, ...props }: ButtonProps) => (
  <button className={cn(baseStyles, variants[variant], className)} {...props}>
    {children}
  </button>
);
