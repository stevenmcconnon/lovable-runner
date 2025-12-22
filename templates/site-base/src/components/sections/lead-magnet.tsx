import { useMemo, useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';
import { useToast } from '../ui/toast';

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  bullets?: PortableTextValue[];
  resourceName?: string;
  privacy?: PortableTextValue;
  submitLabel?: string;
  sectionId?: string;
};

export const LeadMagnet = ({
  title,
  subtitle,
  bullets = [],
  resourceName = 'Guide',
  privacy,
  submitLabel,
  sectionId = 'lead-magnet',
}: Props) => {
  const { pushToast } = useToast();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const slug = typeof window !== 'undefined' ? window.__AI_SITEMAKER_SLUG || '' : '';
  const apiBase = useMemo(() => {
    if (typeof window !== 'undefined' && window.__AI_SITEMAKER_API_BASE) {
      return window.__AI_SITEMAKER_API_BASE.replace(/\/+$/, '');
    }
    const envBase =
      (import.meta.env?.VITE_RUNNER_API_BASE as string | undefined) ||
      (import.meta.env?.VITE_API_BASE as string | undefined) ||
      '';
    return envBase ? envBase.replace(/\/+$/, '') : 'https://api.ai-sitemaker.com';
  }, []);
  const endpoint = slug ? `${apiBase}/contact` : null;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!endpoint) {
      setStatus('error');
      setMessage('Lead capture is not configured yet.');
      return;
    }
    setStatus('loading');
    setMessage('');
    const formData = new FormData(event.currentTarget);
    const payloadFields = ['name', 'email', 'company'].map((field) => ({
      label: field === 'name' ? 'Full name' : field === 'company' ? 'Company' : 'Email',
      name: field,
      type: field === 'email' ? 'email' : 'text',
      value: (formData.get(field) || '').toString(),
    }));
    payloadFields.push({
      label: 'Notes',
      name: 'notes',
      type: 'textarea',
      value: (formData.get('notes') || '').toString(),
    });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          sectionId,
          intent: 'lead-magnet',
          fields: payloadFields,
          metadata: { resourceName },
          sourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || 'Submission failed');
      }
      setStatus('success');
      setMessage('Check your inbox—we just sent the download link.');
      event.currentTarget.reset();
      pushToast('Sent!', 'success');
    } catch (error) {
      console.error('[LeadMagnet] failed', error);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unable to send. Please try again later.');
      pushToast('Unable to send lead capture.', 'error');
    }
  };

  return (
    <section className="section-shell" id={sectionId}>
      <div className="grid gap-8 rounded-3xl bg-slate-900/95 p-8 text-white shadow-2xl md:grid-cols-[1fr_0.85fr]">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-white/60">Download</p>
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          {subtitle ? <RichText value={subtitle} className="text-base text-white/80" /> : null}
          {bullets.length ? (
            <ul className="mt-4 space-y-3 text-sm text-white/80">
              {bullets.map((bullet, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-[hsl(var(--brand))]" />
                  <RichText value={bullet} />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/80">
            Instant download: <span className="font-semibold">{resourceName}</span>
          </div>
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl bg-white p-6 text-slate-900 shadow-xl"
        >
          <div className="space-y-4">
            <label className="text-sm font-medium text-slate-600">
              Full name
              <input
                type="text"
                name="name"
                required
                placeholder="Your name"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              Business email
              <input
                type="email"
                name="email"
                required
                placeholder="you@company.com"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              Company
              <input
                type="text"
                name="company"
                placeholder="Company name"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
              />
            </label>
            <label className="text-sm font-medium text-slate-600">
              What problem should we solve?
              <textarea
                name="notes"
                rows={3}
                placeholder="Tell us a sentence or two"
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
              />
            </label>
            <button
              type="submit"
              disabled={status === 'loading'}
              className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[hsl(var(--brand))] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[hsl(var(--brand)/0.4)] disabled:opacity-60"
            >
              {status === 'loading' ? 'Sending…' : submitLabel || 'Email me the guide'}
            </button>
            {privacy ? (
              <RichText value={privacy} className="text-xs text-slate-500" />
            ) : null}
            {message ? (
              <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-emerald-600'}`}>
                {message}
              </p>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  );
};
