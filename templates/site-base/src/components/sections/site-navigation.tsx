import { useEffect, useMemo, useState } from 'react';
import type { PortableTextValue } from '../rich-text';
import { RichText } from '../rich-text';

type NavLink = {
  label: string;
  href?: string;
  sectionId?: string;
  description?: PortableTextValue;
};

type CTA = {
  label: string;
  href?: string;
  sectionId?: string;
};

type Props = {
  logo?: { text?: string; tagline?: PortableTextValue };
  announcement?: PortableTextValue;
  links?: NavLink[];
  primaryCta?: CTA;
  secondaryCta?: CTA;
  contact?: { phone?: string; email?: string };
};

const scrollToSection = (sectionId?: string) => {
  if (!sectionId || typeof window === 'undefined') return false;
  const target = document.getElementById(sectionId);
  if (!target) return false;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
};

const resolveHref = (link: NavLink) => {
  if (link.href) return link.href;
  if (link.sectionId) return `#${link.sectionId}`;
  return '#';
};

const NavButton = ({ link, onNavigate }: { link: NavLink; onNavigate?: () => void }) => {
  const href = resolveHref(link);
  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (link.sectionId && scrollToSection(link.sectionId)) {
      event.preventDefault();
      onNavigate?.();
    }
  };
  return (
    <a
      href={href}
      onClick={handleClick}
      className="text-sm font-semibold text-slate-700 transition hover:text-slate-900"
    >
      {link.label}
    </a>
  );
};

export const SiteNavigation = ({
  logo = {},
  announcement,
  links = [],
  primaryCta,
  secondaryCta,
  contact,
}: Props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const fallbackLinks = useMemo<NavLink[]>(
    () =>
      links.length
        ? links
        : [
            { label: 'Services', sectionId: 'services' },
            { label: 'Work', sectionId: 'case-studies' },
            { label: 'Reviews', sectionId: 'reviews' },
            { label: 'Contact', sectionId: 'contact' },
          ],
    [links]
  );

  const renderCta = (cta?: CTA, variant: 'primary' | 'secondary' = 'primary') => {
    if (!cta?.label) return null;
    const href = cta.href || (cta.sectionId ? `#${cta.sectionId}` : '#');
    const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (cta.sectionId && scrollToSection(cta.sectionId)) {
        event.preventDefault();
        setIsOpen(false);
      }
    };
    const baseClasses =
      variant === 'primary'
        ? 'bg-[hsl(var(--brand))] text-white shadow-[0_10px_30px_rgba(0,0,0,0.15)]'
        : 'bg-white/80 text-slate-900 border border-slate-200';
    return (
      <a
        href={href}
        onClick={handleClick}
        className={`inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm font-semibold transition hover:-translate-y-0.5 ${baseClasses}`}
      >
        {cta.label}
      </a>
    );
  };

  return (
    <header className={`sticky top-0 z-40 w-full ${scrolled ? 'backdrop-blur-xl' : ''}`} id="top">
      {announcement ? (
        <div className="bg-slate-900/95 px-4 py-2 text-center text-xs font-medium text-white">
          <RichText value={announcement} />
        </div>
      ) : null}
      <div
        className={`border-b border-white/30 px-4 transition duration-200 ${
          scrolled ? 'bg-white/95 shadow-md shadow-slate-900/5' : 'bg-white/70'
        }`}
      >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <a href="#top" className="text-lg font-semibold text-slate-900">
              {logo.text || 'Your brand'}
            </a>
            {logo.tagline ? (
              <RichText
                value={logo.tagline}
                className="hidden text-sm text-slate-500 md:inline"
                inline
              />
            ) : null}
          </div>
          <nav className="hidden items-center gap-6 md:flex">
            {fallbackLinks.map((link) => (
              <NavButton key={link.label} link={link} />
            ))}
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            {secondaryCta ? renderCta(secondaryCta, 'secondary') : null}
            {primaryCta ? renderCta(primaryCta) : null}
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 p-2 text-slate-700 md:hidden"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-label="Toggle navigation"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={isOpen ? 'M6 6l12 12M6 18L18 6' : 'M4 6h16M4 12h16M4 18h16'}
              />
            </svg>
          </button>
        </div>
        {isOpen ? (
          <div className="md:hidden">
            <div className="space-y-4 border-t border-slate-100 px-2 py-4">
              {fallbackLinks.map((link) => (
                <div key={link.label} className="flex flex-col gap-1">
                  <NavButton link={link} onNavigate={() => setIsOpen(false)} />
                  {link.description ? (
                    <RichText
                      value={link.description}
                      className="text-xs text-slate-500"
                    />
                  ) : null}
                </div>
              ))}
              <div className="flex flex-wrap gap-3 pt-2">
                {secondaryCta ? renderCta(secondaryCta, 'secondary') : null}
                {primaryCta ? renderCta(primaryCta) : null}
              </div>
              {contact?.phone || contact?.email ? (
                <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                  {contact.phone ? (
                    <a href={`tel:${contact.phone}`} className="block font-semibold text-slate-900">
                      {contact.phone}
                    </a>
                  ) : null}
                  {contact.email ? (
                    <a href={`mailto:${contact.email}`} className="block text-sm underline">
                      {contact.email}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
};
