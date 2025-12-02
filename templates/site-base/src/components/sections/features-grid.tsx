import { Card } from '../ui/card';
import type { ImageAsset } from '../../content/site-schema';

export type FeaturesGridProps = {
  title: string;
  subtitle: string;
  imagePrompt?: string;
  image?: ImageAsset;
  features: Array<{
    name: string;
    description: string;
    benefit: string;
  }>;
};

export const FeaturesGrid = ({ title, subtitle, features, imagePrompt, image }: FeaturesGridProps) => (
  <section className="section-shell" id="services">
    <div className="mx-auto max-w-5xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--brand-accent))]">Capabilities</p>
      <h2 className="mt-3 text-4xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-lg text-white/70">{subtitle}</p>
    </div>
    <div className="mt-12 grid gap-6 md:grid-cols-2">
      {features.map((feature) => (
        <Card key={feature.name} className="h-full">
          <h3 className="text-2xl font-semibold text-white">{feature.name}</h3>
          <p className="mt-3 text-white/70">{feature.description}</p>
          <p className="mt-4 text-sm font-semibold text-[hsl(var(--brand))]">Outcome · {feature.benefit}</p>
        </Card>
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
            {image.alt ? <figcaption className="mt-3 text-xs uppercase tracking-[0.2em] text-white/50">{image.alt}</figcaption> : null}
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
