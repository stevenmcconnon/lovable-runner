import { Card } from '../ui/card';
import { LightboxImage } from '../ui/lightbox-image';
import { PortableTextValue, RichText } from '../rich-text';
import type { ImageAsset } from '../../content/site-schema';

type FeatureItem = {
  title?: PortableTextValue;
  name?: PortableTextValue;
  subtitle?: PortableTextValue;
  description?: PortableTextValue;
  benefit?: PortableTextValue;
  badge?: PortableTextValue;
  tag?: PortableTextValue;
  outcome?: PortableTextValue;
};

export type FeaturesGridProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  imagePrompt?: string;
  image?: ImageAsset;
  features: FeatureItem[];
};

const resolveFeatureTitle = (feature: FeatureItem): PortableTextValue =>
  feature.title ?? feature.name ?? '';

const resolveFeatureBody = (feature: FeatureItem): PortableTextValue =>
  feature.subtitle ?? feature.description ?? '';

const resolveFeatureFooter = (feature: FeatureItem): PortableTextValue =>
  feature.benefit ?? feature.outcome ?? feature.badge ?? feature.tag ?? '';

export const FeaturesGrid = ({ title, subtitle, features, imagePrompt, image }: FeaturesGridProps) => (
  <section className="section-shell" id="services">
    <div className="mx-auto max-w-5xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--brand-accent))]">Capabilities</p>
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
    <div className="mt-12 grid gap-6 md:grid-cols-2">
      {features.map((feature, index) => {
        const heading = resolveFeatureTitle(feature);
        const body = resolveFeatureBody(feature);
        const footer = resolveFeatureFooter(feature);
        return (
        <Card key={index.toString()} className="h-full">
          <RichText
            value={heading}
            as="h3"
            className="text-2xl font-semibold text-[hsl(var(--surface-foreground))]"
          />
          <RichText
            value={body}
            className="mt-3 text-[hsl(var(--surface-foreground)/0.75)]"
          />
          {footer ? (
            <p className="mt-4 text-sm font-semibold text-[hsl(var(--brand))]">
              <RichText value={footer} inline />
            </p>
          ) : null}
        </Card>
      );
      })}
    </div>
    {image?.src || imagePrompt ? (
      <div className="mx-auto mt-10 max-w-4xl rounded-2xl border border-[hsl(var(--brand)/0.4)] bg-[hsl(var(--brand)/0.12)]/70 p-6 text-sm text-[hsl(var(--surface-foreground)/0.85)] shadow-lg shadow-[hsl(var(--brand)/0.25)]/40">
        {image?.src ? (
          <figure className="space-y-3">
            <LightboxImage image={image} rounded="rounded-xl border border-[hsl(var(--surface-foreground)/0.15)]" overlayLabel="Zoom" />
            {image.alt ? (
              <figcaption className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--surface-foreground)/0.6)]">
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
