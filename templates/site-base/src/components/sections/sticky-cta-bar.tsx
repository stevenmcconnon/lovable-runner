import { useEffect, useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';

type CTA = {
  label: string;
  href?: string;
  sectionId?: string;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  primaryCta: CTA;
  secondaryCta?: CTA;
  phone?: string;
  showThreshold?: number;
};

const scrollToSection = (sectionId?: string) => {
  if (!sectionId || typeof window === 'undefined') return false;
  const target = document.getElementById(sectionId);
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
};

export const StickyCtaBar = ({
  title,
  subtitle,
  primaryCta,
  secondaryCta,
  phone,
  showThreshold = 360,
}: Props) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onScroll = () => {
      setVisible(window.scrollY > showThreshold);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [showThreshold]);

  if (!primaryCta?.label) return null;

  const renderCta = (cta: CTA, variant: 'primary' | 'secondary' = 'primary') => {
    const href = cta.href || (cta.sectionId ? `#${cta.sectionId}` : '#');
    const baseClasses =
      variant === 'primary'
        ? 'bg-[hsl(var(--brand))] text-white shadow-lg shadow-[hsl(var(--brand)/0.35)]'
        : 'bg-white/20 text-white border border-white/40';
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (cta.sectionId && scrollToSection(cta.sectionId)) {
        event.preventDefault();
      }
    };
    return (
      <a
        href={href}
        onClick={handleClick}
        className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ${baseClasses}`}
      >
        {cta.label}
      </a>
    );
  };

  return (
    <div
      aria-hidden={!visible}
      className={`pointer-events-none fixed bottom-6 left-1/2 z-50 w-full max-w-3xl -translate-x-1/2 px-4 transition duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'translate-y-8 opacity-0'
      }`}
    >
      <div className="pointer-events-auto flex flex-col gap-3 rounded-3xl bg-slate-900/95 p-4 text-white shadow-2xl shadow-black/30 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col">
          <RichText value={title} className="text-base font-semibold" />
          {subtitle ? (
            <RichText value={subtitle} className="text-sm text-white/80" />
          ) : null}
          {phone ? (
            <a href={`tel:${phone}`} className="text-sm font-semibold tracking-wide text-[hsl(var(--brand))]">
              {phone}
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {secondaryCta?.label ? renderCta(secondaryCta, 'secondary') : null}
          {renderCta(primaryCta)}
        </div>
      </div>
    </div>
  );
};
