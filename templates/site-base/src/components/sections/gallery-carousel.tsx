import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';
import { LightboxImage } from '../ui/lightbox-image';

type GalleryItem = {
  title?: PortableTextValue;
  caption?: PortableTextValue;
  badge?: string;
  image?: ImageAsset;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  items: GalleryItem[];
  layout?: 'carousel' | 'grid' | 'masonry';
};

const GalleryFigure = ({ item }: { item: GalleryItem }) => (
  <figure className="group relative flex w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-md transition hover:-translate-y-1 hover:shadow-xl">
    {item.image?.src ? (
      <div className="relative w-full overflow-hidden bg-slate-100">
        <LightboxImage image={item.image} overlayLabel="Open" />
        {item.badge ? (
          <span className="absolute left-3 top-3 inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow">
            {item.badge}
          </span>
        ) : null}
      </div>
    ) : null}
    <figcaption className="flex flex-1 flex-col gap-2 p-4">
      {item.title ? (
        <RichText
          value={item.title}
          as="h3"
          className="text-lg font-semibold text-slate-900"
        />
      ) : null}
      {item.caption ? (
        <RichText
          value={item.caption}
          className="text-sm text-slate-600"
        />
      ) : null}
    </figcaption>
  </figure>
);

export const GalleryCarousel = ({ title, subtitle, items = [], layout = 'carousel' }: Props) => {
  if (!items.length) return null;
  return (
    <section className="relative overflow-hidden bg-white/70 px-6 py-14 text-slate-900 shadow-lg shadow-slate-900/5 md:px-12 md:py-20">
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-white via-white to-sky-50" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Gallery</p>
            <RichText
              value={title}
              as="h2"
              className="text-3xl font-semibold leading-tight text-slate-900 md:text-4xl"
            />
            {subtitle ? (
              <RichText
                value={subtitle}
                className="mt-2 max-w-3xl text-base text-slate-600"
              />
            ) : null}
          </div>
        </div>
        {layout === 'masonry' ? (
          <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
            {items.map((item, idx) => (
              <div key={idx} className="mb-4 break-inside-avoid">
                <GalleryFigure item={item} />
              </div>
            ))}
          </div>
        ) : layout === 'grid' ? (
          <div className="grid gap-4 md:grid-cols-3">
            {items.map((item, idx) => (
              <GalleryFigure key={idx} item={item} />
            ))}
          </div>
        ) : (
          <div className="relative">
            <div className="pointer-events-none absolute left-0 top-0 h-full w-16 bg-gradient-to-r from-white via-white/80 to-transparent" />
            <div className="pointer-events-none absolute right-0 top-0 h-full w-16 bg-gradient-to-l from-white via-white/80 to-transparent" />
            <div className="flex snap-x gap-4 overflow-x-auto pb-4">
              {items.map((item, idx) => (
                <div key={idx} className="w-72 min-w-[18rem] snap-start md:w-80">
                  <GalleryFigure item={item} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
