import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import type { ImageAsset } from '../../content/site-schema';

export type HeroWithImageProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  stats: Array<{ label: string; value: string }>;
  imagePrompt?: string;
  image?: ImageAsset;
};

export const HeroWithImage = ({ eyebrow, title, subtitle, primaryCta, secondaryCta, stats, imagePrompt, image }: HeroWithImageProps) => (
  <section className="section-shell" id="top">
    <div className="section-card grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-6">
        <Badge>{eyebrow}</Badge>
        <h1 className="text-4xl font-bold leading-tight text-white md:text-5xl lg:text-6xl">{title}</h1>
        <p className="text-lg text-white/70 md:text-xl">{subtitle}</p>
        <div className="flex flex-wrap gap-4">
          <Button>{primaryCta.label}</Button>
          {secondaryCta ? (
            <Button variant="secondary">{secondaryCta.label}</Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-6">
          {stats.map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-semibold text-white">{stat.value}</p>
              <p className="text-sm text-white/60">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
      <Card className="min-h-[340px] bg-gradient-to-br from-[hsl(var(--brand))]/20 via-white/10 to-[hsl(var(--brand-accent))]/20">
        <div className="rounded-2xl border border-white/20 bg-black/30 p-6 text-white/80">
          {image?.src ? (
            <figure>
              <img
                src={image.src}
                alt={image.alt || title}
                className="h-64 w-full rounded-xl border border-white/10 object-cover"
                loading="lazy"
              />
              {image.alt ? <figcaption className="mt-3 text-sm text-white/70">{image.alt}</figcaption> : null}
            </figure>
          ) : imagePrompt ? (
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-white/50">Imagery direction</p>
              <p className="mt-3 text-base leading-relaxed text-white/80">{imagePrompt}</p>
            </div>
          ) : (
            <p className="text-sm text-white/70">Add an imagePrompt to bring this hero to life.</p>
          )}
        </div>
      </Card>
    </div>
  </section>
);
