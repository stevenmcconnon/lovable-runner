import { Button } from '../ui/button';
import type { ImageAsset } from '../../content/site-schema';

export type CTABannerProps = {
  title: string;
  body: string;
  primaryCta: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
  imagePrompt?: string;
  image?: ImageAsset;
};

export const CTABanner = ({ title, body, primaryCta, secondaryCta, imagePrompt, image }: CTABannerProps) => (
  <section className="section-shell" id="contact">
    <div className="section-card bg-gradient-to-r from-[hsl(var(--brand))]/30 to-[hsl(var(--brand-accent))]/20">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <h2 className="text-4xl font-bold text-[hsl(var(--surface-foreground))]">{title}</h2>
          <p className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.8)]">{body}</p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Button>{primaryCta.label}</Button>
            {secondaryCta ? <Button variant="secondary">{secondaryCta.label}</Button> : null}
          </div>
        </div>
        {image?.src || imagePrompt ? (
          <div className="rounded-2xl border border-white/20 bg-black/30 p-4 text-sm text-white/70">
            {image?.src ? (
              <figure>
                <img
                  src={image.src}
                  alt={image.alt || title}
                  className="h-48 w-full rounded-xl border border-white/10 object-cover"
                  loading="lazy"
                />
                {image.alt ? <figcaption className="mt-2 text-xs text-white/60">{image.alt}</figcaption> : null}
              </figure>
            ) : (
              <p className="leading-relaxed text-white/80">{imagePrompt}</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  </section>
);
