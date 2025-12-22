import { useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';
import { useToast } from '../ui/toast';

type FooterLink = {
  label: string;
  href?: string;
};

type FooterColumn = {
  title: string;
  links?: FooterLink[];
};

type ContactBlock = {
  headline?: PortableTextValue;
  address?: PortableTextValue;
  phone?: string;
  email?: string;
};

type Newsletter = {
  title?: PortableTextValue;
  description?: PortableTextValue;
  placeholder?: string;
  ctaLabel?: string;
  confirmation?: PortableTextValue;
};

type Props = {
  columns?: FooterColumn[];
  contact?: ContactBlock;
  social?: FooterLink[];
  legal?: FooterLink[];
  newsletter?: Newsletter;
};

const LinkList = ({ links }: { links?: FooterLink[] }) => {
  if (!links?.length) return null;
  return (
    <ul className="space-y-2">
      {links.map((link) => (
        <li key={link.label}>
          <a
            href={link.href || '#'}
            className="text-sm text-slate-500 transition hover:text-slate-900"
          >
            {link.label}
          </a>
        </li>
      ))}
    </ul>
  );
};

export const FooterLinks = ({ columns = [], contact, social = [], legal = [], newsletter }: Props) => {
  const { pushToast } = useToast();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'success'>('idle');

  const handleSubscribe = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) return;
    setStatus('success');
    pushToast('Subscribed! We will be in touch.', 'success');
    setEmail('');
  };

  return (
    <footer className="bg-slate-950 text-white">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-10">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-white/50">Company</p>
            {contact?.headline ? (
              <RichText value={contact.headline} as="h2" className="text-3xl font-semibold" />
            ) : (
              <h2 className="text-3xl font-semibold">Let’s keep building together</h2>
            )}
            {contact?.address ? (
              <RichText value={contact.address} className="mt-3 text-sm text-white/70" />
            ) : null}
            <div className="mt-4 space-y-1 text-sm">
              {contact?.phone ? (
                <a href={`tel:${contact.phone}`} className="font-semibold text-white">
                  {contact.phone}
                </a>
              ) : null}
              {contact?.email ? (
                <a href={`mailto:${contact.email}`} className="block text-white/80 underline">
                  {contact.email}
                </a>
              ) : null}
            </div>
            {social.length ? (
              <div className="mt-6 flex flex-wrap gap-3">
                {social.map((link) => (
                  <a
                    key={link.label}
                    href={link.href || '#'}
                    className="inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/80 hover:bg-white/10"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          {newsletter ? (
            <form onSubmit={handleSubscribe} className="rounded-3xl bg-white/10 p-4 text-sm text-white/90">
              {newsletter.title ? (
                <RichText value={newsletter.title} className="text-base font-semibold" />
              ) : (
                <p className="text-base font-semibold">Subscribe for product drops</p>
              )}
              {newsletter.description ? (
                <RichText value={newsletter.description} className="text-xs text-white/70" />
              ) : null}
              <div className="mt-3 flex flex-col gap-2 md:flex-row">
                <input
                  type="email"
                  required
                  placeholder={newsletter.placeholder || 'you@email.com'}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="flex-1 rounded-full border border-white/20 bg-white/10 px-4 py-2 text-white placeholder:text-white/50"
                />
                <button
                  type="submit"
                  className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900"
                >
                  {newsletter.ctaLabel || 'Join list'}
                </button>
              </div>
              {status === 'success' && newsletter.confirmation ? (
                <RichText value={newsletter.confirmation} className="mt-2 text-xs text-emerald-300" />
              ) : null}
            </form>
          ) : null}
        </div>
        <div className="grid gap-8 sm:grid-cols-2">
          {columns.map((column) => (
            <div key={column.title}>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/50">
                {column.title}
              </p>
              <LinkList links={column.links} />
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-white/10 px-6 py-6 text-xs text-white/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} AI SiteMaker. All rights reserved.</p>
          {legal.length ? (
            <div className="flex flex-wrap gap-3">
              {legal.map((link) => (
                <a key={link.label} href={link.href || '#'} className="underline">
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </footer>
  );
};
