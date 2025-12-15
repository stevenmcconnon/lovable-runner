import { Badge } from '../ui/badge';
import { Card } from '../ui/card';
import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';
import { LightboxImage } from '../ui/lightbox-image';

type LogoEntry = {
  name: string;
  href?: string;
  tagline?: PortableTextValue;
  image?: ImageAsset;
  note?: string;
};

export type LogoWallProps = {
  eyebrow?: PortableTextValue;
  title: PortableTextValue;
  subtitle: PortableTextValue;
  logos: LogoEntry[];
};

export const LogoWall = ({ eyebrow, title, subtitle, logos }: LogoWallProps) => {
  if (!Array.isArray(logos) || logos.length === 0) return null;
  return (
    <section className="section-shell" id="trusted-by">
      <div className="section-card space-y-8">
        <div className="space-y-4 text-center">
          {eyebrow ? (
            <div className="flex justify-center">
              <Badge>
                <RichText value={eyebrow} inline />
              </Badge>
            </div>
          ) : null}
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          <RichText
            value={subtitle}
            className="mx-auto max-w-3xl text-base text-[hsl(var(--surface-foreground)/0.7)] md:text-lg"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {logos.map((logo) => (
            <Card
              key={logo.name}
              className="flex flex-col items-center gap-4 bg-white/70 text-center shadow-lg shadow-[hsl(var(--brand)/0.15)]/30"
            >
              {logo.image?.src ? (
                <LightboxImage
                  image={logo.image}
                  rounded="rounded-lg"
                  className="h-12 w-auto"
                  overlayLabel="View"
                />
              ) : (
                <p className="text-xl font-semibold text-[hsl(var(--surface-foreground))]">{logo.name}</p>
              )}
              {logo.tagline ? (
                <RichText
                  value={logo.tagline}
                  className="text-sm text-[hsl(var(--surface-foreground)/0.7)]"
                />
              ) : null}
              {logo.note ? (
                <p className="text-xs uppercase tracking-[0.3em] text-[hsl(var(--surface-foreground)/0.5)]">
                  {logo.note}
                </p>
              ) : null}
              {logo.href ? (
                <a
                  href={logo.href}
                  className="text-xs font-semibold text-[hsl(var(--brand))] underline-offset-4 hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Visit partner
                </a>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
