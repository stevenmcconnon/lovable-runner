import { Button } from '../ui/button';
import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';
import { LightboxImage } from '../ui/lightbox-image';

export type CTABannerProps = {
  title: PortableTextValue;
  body: PortableTextValue;
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
          <RichText
            value={title}
            as="h2"
            className="text-4xl font-bold text-[hsl(var(--surface-foreground))]"
          />
          <RichText
            value={body}
            className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.8)]"
          />
          <div className="mt-8 flex flex-wrap gap-4">
            <Button>{primaryCta.label}</Button>
            {secondaryCta ? <Button variant="secondary">{secondaryCta.label}</Button> : null}
          </div>
        </div>
        {image?.src || imagePrompt ? (
          <div className="rounded-2xl border border-white/20 bg-black/30 p-4 text-sm text-white/70">
            {image?.src ? (
              <figure className="space-y-2">
                <LightboxImage
                  image={image}
                  rounded="rounded-xl border border-white/10"
                  className="h-48 w-full"
                  overlayLabel="Zoom"
                />
                {image.alt ? <figcaption className="text-xs text-white/60">{image.alt}</figcaption> : null}
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
