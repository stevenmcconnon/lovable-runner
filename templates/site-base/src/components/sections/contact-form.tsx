import { useMemo, useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';
import { useToast } from '../ui/toast';

type Field = {
  label: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  options?: string[];
  name?: string;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  fields: Field[];
  submitLabel: string;
  contactEmail?: string;
  reassurance?: PortableTextValue;
  sectionId?: string;
  intent?: string;
};

export const ContactForm = ({
  title,
  subtitle,
  fields = [],
  submitLabel,
  contactEmail,
  reassurance,
  sectionId,
  intent = 'contact',
}: Props) => {
  const { pushToast } = useToast();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [lastSubmittedAt, setLastSubmittedAt] = useState<number | null>(null);
  const mailto = contactEmail ? `mailto:${contactEmail}` : undefined;
  const slug =
    typeof window !== 'undefined' ? window.__AI_SITEMAKER_SLUG || '' : '';
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
  const endpoint = slug && contactEmail ? `${apiBase}/contact` : null;

  const fieldName = (field: Field, index: number) => {
    if (field.name) return field.name;
    const base = field.label?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || `field-${index + 1}`;
    return `${base}-${index}`;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!endpoint) {
      if (mailto) {
        window.location.href = mailto;
        return;
      }
      setStatus('error');
      setStatusMessage('Contact email is not configured yet.');
      return;
    }
    if (lastSubmittedAt && Date.now() - lastSubmittedAt < 2000) {
      return;
    }
    setStatus('loading');
    setStatusMessage('');
    const formData = new FormData(event.currentTarget);
    const formattedFields = fields.map((field, index) => {
      const name = fieldName(field, index);
      const baseValue =
        field.type === 'checkbox' ? formData.getAll(name) : formData.get(name);
      const value = Array.isArray(baseValue)
        ? baseValue.map((entry) => (entry ?? '').toString()).filter(Boolean)
        : (baseValue ?? '').toString();
      return {
        label: field.label || `Field ${index + 1}`,
        name,
        type: field.type || 'text',
        value,
      };
    });
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          sectionId,
          fields: formattedFields,
          sourceUrl: window.location.href,
          intent,
        }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || 'Submission failed');
      }
      event.currentTarget.reset();
      setStatus('success');
      setStatusMessage('Thanks! We received your message and will reply shortly.');
      setLastSubmittedAt(Date.now());
      pushToast('Message sent!', 'success');
    } catch (error) {
      console.error('[ContactForm] submission failed', error);
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Unable to send your message. Please try again.');
      pushToast('Unable to send message. Please try again.', 'error');
    }
  };

  return (
    <section className="bg-white px-6 py-14 text-slate-900 md:px-12 md:py-20">
      <div className="mx-auto grid max-w-6xl gap-10 rounded-3xl bg-gradient-to-r from-white via-white to-blue-50 p-8 shadow-lg shadow-slate-900/5 md:grid-cols-2 md:p-12">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Contact</p>
          <RichText
            value={title}
            as="h2"
            className="text-3xl font-semibold leading-tight md:text-4xl"
          />
          {subtitle ? <RichText value={subtitle} className="text-base text-slate-600" /> : null}
          {reassurance ? (
            <div className="mt-2 rounded-2xl bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
              <RichText value={reassurance} />
            </div>
          ) : null}
          {contactEmail ? (
            <a
              className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:shadow-xl"
              href={mailto}
            >
              Email us directly
            </a>
          ) : null}
        </div>
        <form
          className="flex flex-col gap-4 rounded-2xl bg-white/80 p-6 shadow-inner shadow-slate-200"
          onSubmit={handleSubmit}
          noValidate
        >
          {fields.map((field, idx) => {
            const name = fieldName(field, idx);
            const options = Array.isArray(field.options) ? field.options : [];
            if ((field.type === 'radio' || field.type === 'checkbox') && options.length) {
              return (
                <fieldset key={field.label || idx} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
                  <legend className="text-sm font-semibold text-slate-900">{field.label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {options.map((option) => (
                      <label key={option} className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type={field.type}
                          name={name}
                          value={option}
                          required={field.required}
                          className="h-4 w-4 accent-slate-900"
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            return (
              <label key={field.label || idx} className="flex flex-col gap-2 text-sm font-medium text-slate-800">
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    placeholder={field.placeholder}
                    required={field.required}
                    rows={4}
                    name={name}
                  />
                ) : (
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    placeholder={field.placeholder}
                    required={field.required}
                    type={field.type || 'text'}
                    name={name}
                  />
                )}
              </label>
            );
          })}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-60"
          >
            {status === 'loading' ? 'Sending…' : submitLabel || 'Send message'}
          </button>
          {statusMessage ? (
            <p
              className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-600'}`}
            >
              {statusMessage}
            </p>
          ) : null}
          {!contactEmail ? (
            <p className="text-xs text-slate-500">
              Configure <code>contactEmail</code> so we can deliver incoming requests directly to you.
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
};
