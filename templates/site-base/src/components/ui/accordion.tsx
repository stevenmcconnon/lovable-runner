import { cn } from '../../lib/cn';
import { useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';

type AccordionItem = {
  id: string;
  question: PortableTextValue;
  answer: PortableTextValue;
};

type AccordionProps = {
  items: AccordionItem[];
};

export const Accordion = ({ items }: AccordionProps) => {
  const defaultId = items[0]?.id || (items.length ? `accordion-item-0` : '');
  const [openId, setOpenId] = useState(defaultId);
  return (
    <div className="divide-y divide-[hsl(var(--surface-foreground)/0.1)] rounded-2xl border border-[hsl(var(--surface-foreground)/0.15)] bg-[hsl(var(--surface-foreground)/0.03)]">
      {items.map((item, idx) => {
        const itemId = item.id || `accordion-item-${idx}`;
        const isOpen = openId === itemId;
        return (
        <button
          key={itemId}
          type="button"
          className="w-full text-left"
          onClick={() => setOpenId((prev) => (prev === itemId ? '' : itemId))}
        >
          <div className="flex items-center justify-between px-6 py-5">
            <RichText
              value={item.question}
              className="text-lg font-semibold text-[hsl(var(--surface-foreground)/0.9)]"
              inline
            />
            <span className="text-[hsl(var(--brand))]">{isOpen ? '-' : '+'}</span>
          </div>
          <div
            className={cn(
              'overflow-hidden px-6 pb-6 text-base text-[hsl(var(--surface-foreground)/0.7)] transition-all duration-300',
              isOpen ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
            )}
          >
            <RichText value={item.answer} />
          </div>
        </button>
      );
      })}
    </div>
  );
};
