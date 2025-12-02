import { cn } from '../../lib/cn';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'default' | 'secondary' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  children: ReactNode;
};

const baseStyles = 'inline-flex items-center justify-center rounded-full font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';
const variants: Record<Variant, string> = {
  default: 'bg-[hsl(var(--brand))] text-white shadow-lg hover:brightness-110 px-6 py-3',
  secondary: 'bg-white/10 text-white border border-white/20 px-6 py-3 hover:bg-white/20',
  ghost: 'bg-transparent text-white hover:text-[hsl(var(--brand))] px-4 py-2',
};

export const Button = ({ variant = 'default', className, children, ...props }: ButtonProps) => (
  <button className={cn(baseStyles, variants[variant], className)} {...props}>
    {children}
  </button>
);
