import type { ImageAsset } from '../../content/site-schema';

export type StatsShowcaseProps = {
  title: string;
  subtitle: string;
  imagePrompt?: string;
  image?: ImageAsset;
  stats: Array<{ label: string; value: string; helper?: string }>;
};

export const StatsShowcase = ({ title, subtitle, stats, imagePrompt, image }: StatsShowcaseProps) => (
  <section className="section-shell" id="results">
    <div className="mx-auto max-w-4xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--brand-accent))]">Proof</p>
      <h2 className="mt-3 text-4xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-lg text-white/70">{subtitle}</p>
    </div>
    <div className="mt-12 grid gap-6 md:grid-cols-4">
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-white">
          <p className="text-3xl font-bold">{stat.value}</p>
          <p className="mt-2 text-sm text-white/70">{stat.label}</p>
          {stat.helper ? <p className="mt-1 text-xs text-white/60">{stat.helper}</p> : null}
        </div>
      ))}
    </div>
    {(image?.src || imagePrompt) ? (
      <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        {image?.src ? (
          <figure>
            <img
              src={image.src}
              alt={image.alt || title}
              className="max-h-80 w-full rounded-xl border border-white/10 object-cover"
              loading="lazy"
            />
            {image.alt ? <figcaption className="mt-3 text-xs uppercase tracking-[0.3em] text-white/50">{image.alt}</figcaption> : null}
          </figure>
        ) : (
          <>
            <p className="mt-4 text-xs uppercase tracking-[0.3em] text-white/50">Imagery brief</p>
            <p className="mt-3 leading-relaxed">{imagePrompt}</p>
          </>
        )}
      </div>
    ) : null}
  </section>
);
