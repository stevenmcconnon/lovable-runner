import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';

export type StatsShowcaseProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  imagePrompt?: string;
  image?: ImageAsset;
  stats: Array<{ label: string; value: string; helper?: string }>;
};

export const StatsShowcase = ({ title, subtitle, stats, imagePrompt, image }: StatsShowcaseProps) => (
  <section className="section-shell" id="results">
    <div className="mx-auto max-w-4xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--brand-accent))]">Proof</p>
      <RichText
        value={title}
        as="h2"
        className="mt-3 text-4xl font-semibold text-[hsl(var(--surface-foreground))]"
      />
      <RichText
        value={subtitle}
        className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.75)]"
      />
    </div>
    <div className="mt-12 grid gap-6 md:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-2xl border border-[hsl(var(--brand)/0.4)] bg-[hsl(var(--brand)/0.12)]/70 p-6 text-center text-[hsl(var(--surface-foreground))] shadow-md shadow-[hsl(var(--brand)/0.25)]/50"
        >
          <p className="text-3xl font-bold">{stat.value}</p>
          <p className="mt-2 text-sm text-[hsl(var(--surface-foreground)/0.7)]">{stat.label}</p>
          {stat.helper ? <p className="mt-1 text-xs text-[hsl(var(--surface-foreground)/0.6)]">{stat.helper}</p> : null}
        </div>
      ))}
    </div>
    {image?.src || imagePrompt ? (
      <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-[hsl(var(--brand)/0.4)] bg-[hsl(var(--brand-accent)/0.12)]/70 p-6 text-sm text-[hsl(var(--surface-foreground)/0.85)] shadow-lg shadow-[hsl(var(--brand-accent)/0.25)]/40">
        {image?.src ? (
          <figure>
            <img
              src={image.src}
              alt={image.alt || (typeof title === 'string' ? title : 'Showcase image')}
              className="max-h-80 w-full rounded-xl border border-[hsl(var(--surface-foreground)/0.15)] object-cover"
              loading="lazy"
            />
            {image.alt ? (
              <figcaption className="mt-3 text-xs uppercase tracking-[0.3em] text-[hsl(var(--surface-foreground)/0.6)]">
                {image.alt}
              </figcaption>
            ) : null}
          </figure>
        ) : (
          <>
            <p className="mt-4 text-xs uppercase tracking-[0.3em] text-[hsl(var(--surface-foreground)/0.6)]">Imagery brief</p>
            <p className="mt-3 leading-relaxed text-[hsl(var(--surface-foreground)/0.85)]">{imagePrompt}</p>
          </>
        )}
      </div>
    ) : null}
  </section>
);
