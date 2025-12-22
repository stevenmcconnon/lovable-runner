import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';

type Metric = {
  label: string;
  value: string;
};

type InventoryItem = {
  title: string;
  subtitle?: PortableTextValue;
  price?: string;
  media?: ImageAsset;
  metrics?: Metric[];
  badge?: string;
  description?: PortableTextValue;
  cta?: { label: string; href?: string };
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  items?: InventoryItem[];
  layout?: 'grid' | 'carousel';
  sectionId?: string;
};

const InventoryCard = ({ item }: { item: InventoryItem }) => (
  <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white/95 shadow-md shadow-slate-900/5">
    {item.media?.src ? (
      <div className="relative">
        <img src={item.media.src} alt={item.media.alt || item.title} className="h-56 w-full object-cover" loading="lazy" />
        {item.badge ? (
          <span className="absolute left-4 top-4 inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-900 shadow">
            {item.badge}
          </span>
        ) : null}
      </div>
    ) : null}
    <div className="flex flex-1 flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-lg font-semibold text-slate-900">{item.title}</p>
        {item.price ? <p className="text-base font-semibold text-[hsl(var(--brand))]">{item.price}</p> : null}
      </div>
      {item.subtitle ? <RichText value={item.subtitle} className="text-sm text-slate-600" /> : null}
      {item.metrics?.length ? (
        <dl className="grid gap-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 md:grid-cols-2">
          {item.metrics.map((metric) => (
            <div key={`${item.title}-${metric.label}`}> 
              <dt className="text-xs uppercase tracking-[0.4em] text-slate-400">{metric.label}</dt>
              <dd className="text-base font-semibold text-slate-900">{metric.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.description ? (
        <RichText value={item.description} className="text-sm text-slate-600" />
      ) : null}
      {item.cta?.label ? (
        <a
          href={item.cta.href || '#contact'}
          className="mt-auto inline-flex items-center gap-2 text-sm font-semibold text-[hsl(var(--brand))]"
        >
          {item.cta.label}
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ) : null}
    </div>
  </div>
);

export const InventoryList = ({
  title,
  subtitle,
  items = [],
  layout = 'grid',
  sectionId = 'inventory',
}: Props) => {
  if (!items.length) return null;
  return (
    <section className="section-shell" id={sectionId}>
      <div className="section-card">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Available now</p>
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          {subtitle ? (
            <RichText value={subtitle} className="text-base text-slate-600" />
          ) : null}
        </div>
        {layout === 'carousel' ? (
          <div className="mt-8 flex gap-5 overflow-x-auto pb-4">
            {items.map((item) => (
              <div key={item.title} className="w-80 min-w-[18rem] flex-1">
                <InventoryCard item={item} />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {items.map((item) => (
              <InventoryCard key={item.title} item={item} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
