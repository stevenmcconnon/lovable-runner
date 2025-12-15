import { useEffect, useMemo, useState } from 'react';
import { Card } from '../ui/card';
import { PortableTextValue, RichText } from '../rich-text';

export type TestimonialsCardsProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  testimonials: Array<{
    name: string;
    role: string;
    quote: PortableTextValue;
    highlight: string;
  }>;
  mode?: 'static' | 'dynamic' | 'blended';
  dynamicLimit?: number;
};

type RemoteReview = {
  authorName: string;
  body: string;
  rating?: number;
};

export const TestimonialsCards = ({
  title,
  subtitle,
  testimonials,
  mode = 'static',
  dynamicLimit = 6,
}: TestimonialsCardsProps) => {
  const [remoteReviews, setRemoteReviews] = useState<RemoteReview[]>([]);
  const [loading, setLoading] = useState(false);
  const slug = typeof window !== 'undefined' ? window.__AI_SITEMAKER_SLUG || '' : '';
  const apiBase =
    typeof window !== 'undefined' && window.__AI_SITEMAKER_API_BASE
      ? window.__AI_SITEMAKER_API_BASE.replace(/\/+$/, '')
      : (import.meta.env?.VITE_RUNNER_API_BASE as string | undefined) ||
        (import.meta.env?.VITE_API_BASE as string | undefined) ||
        '';

  useEffect(() => {
    if (!slug || mode === 'static') return;
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `${apiBase || 'https://api.ai-sitemaker.com'}/reviews?slug=${slug}&limit=${dynamicLimit}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error('Failed to fetch reviews');
        const data = await response.json();
        setRemoteReviews(
          (data?.items || []).map((item: any) => ({
            authorName: item.authorName || 'Happy client',
            body: item.body,
            rating: item.rating,
          }))
        );
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          console.warn('[TestimonialsCards] unable to fetch reviews', error);
        }
      } finally {
        setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [slug, apiBase, mode, dynamicLimit]);

  const merged = useMemo(() => {
    if (mode === 'static') return testimonials;
    if (mode === 'dynamic') {
      if (remoteReviews.length) {
        return remoteReviews.map((review) => ({
          name: review.authorName,
          role: `${review.rating ? `${review.rating}★ ` : ''}Verified review`,
          quote: [{ _type: 'block', children: [{ _type: 'span', text: review.body }] }],
          highlight: 'Client feedback',
        }));
      }
      return testimonials;
    }
    // blended
    const dynamicCards = remoteReviews.map((review) => ({
      name: review.authorName,
      role: `${review.rating ? `${review.rating}★ ` : ''}Client`,
      quote: [{ _type: 'block', children: [{ _type: 'span', text: review.body }] }],
      highlight: 'Recent review',
    }));
    return [...dynamicCards, ...testimonials].slice(0, Math.max(3, dynamicLimit));
  }, [mode, remoteReviews, testimonials, dynamicLimit]);

  return (
    <section className="section-shell" id="reviews">
      <div className="mx-auto max-w-4xl text-center">
        <RichText
          value={title}
          as="h2"
          className="text-4xl font-semibold text-[hsl(var(--surface-foreground))]"
        />
        <RichText
          value={subtitle}
          className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.75)]"
        />
      </div>
      <div className="mt-12 grid gap-6 md:grid-cols-3">
        {merged.map((testimonial, index) => (
          <Card key={`${testimonial.name}-${index}`} className="h-full bg-white/[0.07]">
            <p className="text-sm font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
              {testimonial.highlight}
            </p>
            <div className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.9)]">
              “<RichText value={testimonial.quote} inline />”
            </div>
            <div className="mt-6 text-sm text-[hsl(var(--surface-foreground)/0.7)]">
              <p className="font-semibold text-[hsl(var(--surface-foreground))]">{testimonial.name}</p>
              <p>{testimonial.role}</p>
            </div>
          </Card>
        ))}
        {loading && merged.length === 0 ? (
          <div className="rounded-3xl bg-white/50 p-6 text-sm text-slate-500 shadow-inner">
            Loading latest reviews…
          </div>
        ) : null}
      </div>
    </section>
  );
};
