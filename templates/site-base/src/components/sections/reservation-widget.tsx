import { useMemo, useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';
import { useToast } from '../ui/toast';

type SeatingPreference = {
  label: string;
  value: string;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  submitLabel?: string;
  seatingOptions?: SeatingPreference[];
  availabilityNote?: PortableTextValue;
  sectionId?: string;
};

export const ReservationWidget = ({
  title,
  subtitle,
  submitLabel,
  seatingOptions = [],
  availabilityNote,
  sectionId = 'reservations',
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

  const normalizedSeating = seatingOptions.length
    ? seatingOptions
    : [
        { label: 'Dining room', value: 'dining' },
        { label: 'Patio', value: 'patio' },
        { label: 'Bar', value: 'bar' },
      ];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!endpoint) {
      setStatus('error');
      setMessage('We cannot capture reservations yet. Please call.');
      return;
    }
    setStatus('loading');
    setMessage('');
    const formData = new FormData(event.currentTarget);
    const fields = [
      { label: 'Guest name', name: 'name', type: 'text' },
      { label: 'Email', name: 'email', type: 'email' },
      { label: 'Phone', name: 'phone', type: 'tel' },
      { label: 'Party size', name: 'partySize', type: 'number' },
      { label: 'Reservation date', name: 'date', type: 'date' },
      { label: 'Reservation time', name: 'time', type: 'time' },
      { label: 'Seating', name: 'seating', type: 'select' },
      { label: 'Requests', name: 'requests', type: 'textarea' },
    ].map((field) => ({
      label: field.label,
      name: field.name,
      type: field.type,
      value: (formData.get(field.name) || '').toString(),
    }));
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          sectionId,
          intent: 'reservation',
          fields,
          sourceUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || 'Reservation failed');
      }
      setStatus('success');
      setMessage('Reservation request sent! We will confirm shortly.');
      event.currentTarget.reset();
      pushToast('Reservation sent', 'success');
    } catch (error) {
      console.error('[ReservationWidget] failed', error);
      setStatus('error');
      setMessage(
        error instanceof Error ? error.message : 'Unable to send reservation. Please try again.'
      );
      pushToast('Unable to send reservation. Try again later.', 'error');
    }
  };

  return (
    <section className="section-shell" id={sectionId}>
      <div className="section-card grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Reserve a table</p>
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          {subtitle ? (
            <RichText value={subtitle} className="mt-2 text-base text-slate-600" />
          ) : null}
          {availabilityNote ? (
            <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
              <RichText value={availabilityNote} />
            </div>
          ) : null}
        </div>
        <form
          onSubmit={handleSubmit}
          className="rounded-3xl border border-white bg-white/90 p-6 shadow-inner shadow-slate-200"
        >
          <div className="grid gap-4">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-600">
                Email
                <input
                  type="email"
                  name="email"
                  required
                  placeholder="you@email.com"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
                />
              </label>
              <label className="text-sm font-medium text-slate-600">
                Phone
                <input
                  type="tel"
                  name="phone"
                  placeholder="(555) 123-4567"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
                />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-600">
                Party size
                <input
                  type="number"
                  name="partySize"
                  min={1}
                  placeholder="2"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
                />
              </label>
              <label className="text-sm font-medium text-slate-600">
                Seating preference
                <select name="seating" className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3">
                  {normalizedSeating.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-600">
                Date
                <input
                  type="date"
                  name="date"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
                />
              </label>
              <label className="text-sm font-medium text-slate-600">
                Time
                <input
                  type="time"
                  name="time"
                  className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
                />
              </label>
            </div>
            <label className="text-sm font-medium text-slate-600">
              Special requests
              <textarea
                name="requests"
                rows={3}
                placeholder="Allergies, celebrations, etc."
                className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3"
              />
            </label>
            <button
              type="submit"
              disabled={status === 'loading'}
              className="mt-2 inline-flex w-full items-center justify-center rounded-full bg-[hsl(var(--brand))] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[hsl(var(--brand)/0.35)] disabled:opacity-60"
            >
              {status === 'loading' ? 'Sending…' : submitLabel || 'Request reservation'}
            </button>
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
