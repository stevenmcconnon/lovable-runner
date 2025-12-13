import { cn } from '../../lib/cn';
import { useState } from 'react';

type AccordionItem = {
  id: string;
  question: string;
  answer: string;
};

type AccordionProps = {
  items: AccordionItem[];
};

export const Accordion = ({ items }: AccordionProps) => {
  const [openId, setOpenId] = useState(items[0]?.id ?? '');
  return (
    <div className="divide-y divide-[hsl(var(--surface-foreground)/0.1)] rounded-2xl border border-[hsl(var(--surface-foreground)/0.15)] bg-[hsl(var(--surface-foreground)/0.03)]">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="w-full text-left"
          onClick={() => setOpenId((prev) => (prev === item.id ? '' : item.id))}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <span className="text-lg font-semibold text-[hsl(var(--surface-foreground)/0.9)]">{item.question}</span>
            <span className="text-[hsl(var(--brand))]">{openId === item.id ? '-' : '+'}</span>
          </div>
          <div
            className={cn(
              'px-6 pb-6 text-base text-[hsl(var(--surface-foreground)/0.7)] transition-all',
              openId === item.id ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
            )}
          >
            {item.answer}
          </div>
        </button>
      ))}
    </div>
  );
};
