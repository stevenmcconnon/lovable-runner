import { useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';
import { useToast } from '../ui/toast';

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  thankYou?: PortableTextValue;
  sectionId?: string;
};

export const ReviewCollector = ({ title, subtitle, thankYou }: Props) => {
  const { pushToast } = useToast();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const slug = typeof window !== 'undefined' ? window.__AI_SITEMAKER_SLUG || '' : '';
  const apiBase =
    typeof window !== 'undefined' && window.__AI_SITEMAKER_API_BASE
      ? window.__AI_SITEMAKER_API_BASE
      : (import.meta.env?.VITE_RUNNER_API_BASE as string | undefined) ||
        (import.meta.env?.VITE_API_BASE as string | undefined) ||
        'https://api.ai-sitemaker.com';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!slug) return;
    const formData = new FormData(event.currentTarget);
    setStatus('loading');
    setMessage('');
    try {
      const response = await fetch(`${apiBase.replace(/\/+$/, '')}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          authorName: formData.get('name'),
          rating: Number(formData.get('rating')) || undefined,
          body: formData.get('body'),
          contactEmail: formData.get('email') || undefined,
          source: 'on-site',
        }),
      });
      if (!response.ok) {
        const errorJson = await response.json().catch(() => null);
        throw new Error(errorJson?.error || 'Unable to submit review');
      }
      event.currentTarget.reset();
      setStatus('success');
      setMessage('Thanks for sharing your review!');
      pushToast('Review received', 'success');
    } catch (error) {
      console.error('[ReviewCollector] failed to submit review', error);
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unable to submit review.');
      pushToast('Unable to submit review', 'error');
    }
  };

  return (
    <section className="section-shell" id="share-review">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white/80 p-8 text-center shadow-2xl shadow-black/5">
        <RichText
          value={title}
          as="h2"
          className="text-3xl font-semibold text-[hsl(var(--surface-foreground))]"
        />
        {subtitle ? (
          <RichText
            value={subtitle}
            className="mt-3 text-base text-[hsl(var(--surface-foreground)/0.8)]"
          />
        ) : null}
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4 text-left">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Your name
            <input
              name="name"
              placeholder="Jane Doe"
              className="rounded-2xl border border-slate-200 px-3 py-3"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Rating
            <select name="rating" defaultValue="5" className="rounded-2xl border border-slate-200 px-3 py-3">
              {[5, 4, 3, 2, 1].map((rating) => (
                <option key={rating} value={rating}>
                  {rating} Stars
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Review
            <textarea
              name="body"
              rows={4}
              placeholder="Tell others about your experience"
              className="rounded-2xl border border-slate-200 px-3 py-3"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Email (optional, for follow-up)
            <input name="email" type="email" className="rounded-2xl border border-slate-200 px-3 py-3" />
          </label>
          <button
            type="submit"
            disabled={status === 'loading'}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-[hsl(var(--brand))] px-5 py-3 text-sm font-semibold text-white shadow-lg disabled:opacity-60"
          >
            {status === 'loading' ? 'Submitting…' : 'Submit review'}
          </button>
          {message ? (
            <p className={`text-sm ${status === 'error' ? 'text-red-600' : 'text-green-700'}`}>{message}</p>
          ) : null}
          {thankYou ? (
            <p className="text-xs text-[hsl(var(--surface-foreground)/0.6)]">
              <RichText value={thankYou} />
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
};
