type GalleryItem = {
  title?: string;
  caption?: string;
  badge?: string;
  image?: {
    src: string;
    alt?: string;
  };
};

type Props = {
  title: string;
  subtitle?: string;
  items: GalleryItem[];
};

export const GalleryCarousel = ({ title, subtitle, items = [] }: Props) => {
  if (!items.length) return null;
  return (
    <section className="relative overflow-hidden bg-white/70 px-6 py-14 text-slate-900 shadow-lg shadow-slate-900/5 md:px-12 md:py-20">
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-white via-white to-sky-50" />
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Gallery</p>
            <h2 className="text-3xl font-semibold leading-tight text-slate-900 md:text-4xl">{title}</h2>
            {subtitle ? <p className="mt-2 max-w-3xl text-base text-slate-600">{subtitle}</p> : null}
          </div>
        </div>
        <div className="relative">
          <div className="pointer-events-none absolute left-0 top-0 h-full w-16 bg-gradient-to-r from-white via-white/80 to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 h-full w-16 bg-gradient-to-l from-white via-white/80 to-transparent" />
          <div className="flex snap-x gap-4 overflow-x-auto pb-4">
            {items.map((item, idx) => (
              <figure
                key={item.title || idx}
                className="group relative flex w-72 min-w-[18rem] snap-start flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-md transition hover:-translate-y-1 hover:shadow-xl md:w-80"
              >
                {item.image?.src ? (
                  <div className="relative h-48 w-full overflow-hidden bg-slate-100">
                    <img
                      src={item.image.src}
                      alt={item.image.alt || item.title || 'Gallery image'}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    {item.badge ? (
                      <span className="absolute left-3 top-3 inline-flex rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 shadow">
                        {item.badge}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <figcaption className="flex flex-1 flex-col gap-2 p-4">
                  {item.title ? <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3> : null}
                  {item.caption ? <p className="text-sm text-slate-600">{item.caption}</p> : null}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
