import { useMemo, useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';
import { useToast } from '../ui/toast';

type Slot = {
  label: string;
  value: string;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  services?: Slot[];
  submitLabel?: string;
  availabilityHint?: PortableTextValue;
  sectionId?: string;
};

export const BookingWidget = ({
  title,
  subtitle,
  services = [],
  submitLabel,
  availabilityHint,
  sectionId,
}: Props) => {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const { pushToast } = useToast();
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
  const serviceOptions = (services.length
    ? services.map((entry) =>
        typeof entry === 'string' ? { label: entry, value: entry } : entry
      )
    : [{ label: 'Consultation', value: 'consultation' }]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!endpoint) {
      setStatus('error');
      setStatusMessage('Unable to send booking yet. Try again soon.');
      return;
    }
    const formData = new FormData(event.currentTarget);
    const payloadFields = [
      { label: 'Full name', name: 'name', type: 'text' },
      { label: 'Email', name: 'email', type: 'email' },
      { label: 'Phone', name: 'phone', type: 'tel' },
      { label: 'Service', name: 'service', type: 'select' },
      { label: 'Preferred date', name: 'date', type: 'date' },
      { label: 'Preferred time', name: 'time', type: 'time' },
      { label: 'Notes', name: 'notes', type: 'textarea' },
    ].map((field) => ({
      label: field.label,
      name: field.name,
      type: field.type,
      value: (formData.get(field.name) || '').toString(),
    }));
    setStatus('loading');
    setStatusMessage('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          sectionId,
          intent: 'booking',
          fields: payloadFields,
          sourceUrl: window.location.href,
        }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || 'Booking failed');
      }
      event.currentTarget.reset();
      setStatus('success');
      setStatusMessage('Booking request sent! We will confirm shortly.');
      pushToast('Booking request sent', 'success');
    } catch (error) {
      console.error('[BookingWidget] failed to send booking', error);
      setStatus('error');
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to send booking. Please try again.'
      );
      pushToast('Unable to send booking. Try again.', 'error');
    }
  };

  return (
    <section className="section-shell" id="booking">
      <div className="grid gap-10 rounded-3xl bg-white/85 p-8 text-left shadow-2xl shadow-slate-900/5 md:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--brand-accent))]">Booking</p>
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          {subtitle ? (
            <RichText
              value={subtitle}
              className="text-base text-[hsl(var(--surface-foreground)/0.75)]"
            />
          ) : null}
          {availabilityHint ? (
            <div className="rounded-2xl bg-[hsl(var(--brand)/0.08)] p-4 text-sm text-[hsl(var(--surface-foreground))]">
              <RichText value={availabilityHint} />
            </div>
          ) : null}
        </div>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 rounded-2xl border border-white bg-white/80 p-6 shadow-inner shadow-slate-200"
        >
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Full name
            <input
              required
              name="name"
              type="text"
              placeholder="Your name"
              className="rounded-xl border border-slate-200 px-3 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Email
            <input
              required
              name="email"
              type="email"
              placeholder="you@email.com"
              className="rounded-xl border border-slate-200 px-3 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Phone
            <input
              name="phone"
              type="tel"
              placeholder="(555) 123-4567"
              className="rounded-xl border border-slate-200 px-3 py-3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Service
            <select
              name="service"
              className="rounded-xl border border-slate-200 px-3 py-3"
              defaultValue=""
              required
            >
              <option value="" disabled>
                Select a service
              </option>
              {serviceOptions.map((service) => (
                <option key={service.value} value={service.value}>
                  {service.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Preferred date
              <input name="date" type="date" className="rounded-xl border border-slate-200 px-3 py-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              Preferred time
              <input name="time" type="time" className="rounded-xl border border-slate-200 px-3 py-3" />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Notes
            <textarea
              name="notes"
              rows={3}
              placeholder="Tell us what you need"
              className="rounded-xl border border-slate-200 px-3 py-3"
            />
          </label>
          <button
            type="submit"
            disabled={status === 'loading'}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-[hsl(var(--brand))] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-[hsl(var(--brand)/0.4)] disabled:opacity-60"
          >
            {status === 'loading' ? 'Sending…' : submitLabel || 'Request booking'}
          </button>
          {statusMessage ? (
            <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`}>
              {statusMessage}
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
};
