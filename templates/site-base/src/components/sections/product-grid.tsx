import { Card } from '../ui/card';
import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';
import { LightboxImage } from '../ui/lightbox-image';

type ProductEntry = {
  name: PortableTextValue;
  description: PortableTextValue;
  price: string;
  badge?: string;
  image?: ImageAsset;
  features?: string[];
  cta?: { label: string; href: string };
};

export type ProductGridProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  products: ProductEntry[];
};

export const ProductGrid = ({ title, subtitle, products }: ProductGridProps) => {
  if (!Array.isArray(products) || products.length === 0) return null;
  return (
    <section className="section-shell" id="products">
      <div className="section-card space-y-10">
        <div className="space-y-4 text-center">
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          <RichText
            value={subtitle}
            className="mx-auto max-w-3xl text-base text-[hsl(var(--surface-foreground)/0.7)] md:text-lg"
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {products.map((product, idx) => (
            <Card
              key={idx}
              className="flex h-full flex-col justify-between gap-4 bg-white/85 text-[hsl(var(--surface-foreground))]"
            >
              <div className="space-y-4">
                {product.badge ? (
                  <span className="inline-flex rounded-full bg-[hsl(var(--brand)/0.12)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-[hsl(var(--brand))]">
                    {product.badge}
                  </span>
                ) : null}
                {product.image?.src ? (
                  <LightboxImage
                    image={product.image}
                    rounded="rounded-2xl"
                    className="h-40 w-full"
                    overlayLabel="Zoom"
                  />
                ) : null}
                <RichText value={product.name} as="h3" className="text-2xl font-semibold" />
                <p className="text-3xl font-bold text-[hsl(var(--brand))]">{product.price}</p>
                <RichText
                  value={product.description}
                  className="text-sm leading-relaxed text-[hsl(var(--surface-foreground)/0.75)]"
                />
                {Array.isArray(product.features) && product.features.length ? (
                  <ul className="space-y-2 text-sm text-[hsl(var(--surface-foreground)/0.8)]">
                    {product.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--brand))]" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {product.cta ? (
                <a
                  href={product.cta.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex w-full items-center justify-center rounded-full bg-[hsl(var(--brand))] px-6 py-3 text-sm font-semibold text-[hsl(var(--on-brand-foreground))] shadow-lg shadow-[hsl(var(--brand)/0.25)] transition hover:brightness-110"
                >
                  {product.cta.label}
                </a>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
