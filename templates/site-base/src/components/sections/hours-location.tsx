import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';

type HoursRow = {
  label: string;
  value: string;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  address?: PortableTextValue;
  hours?: HoursRow[];
  parking?: PortableTextValue;
  mapEmbedUrl?: string;
  mapImage?: ImageAsset;
  sectionId?: string;
};

export const HoursLocation = ({
  title,
  subtitle,
  address,
  hours = [],
  parking,
  mapEmbedUrl,
  mapImage,
  sectionId = 'location',
}: Props) => {
  return (
    <section className="section-shell" id={sectionId}>
      <div className="section-card grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
              Visit us
            </p>
            <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
            {subtitle ? (
              <RichText value={subtitle} className="mt-2 max-w-2xl text-base text-slate-600" />
            ) : null}
          </div>
          {address ? (
            <div className="rounded-2xl bg-white/80 p-4 shadow-inner shadow-slate-200">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Address</p>
              <RichText value={address} className="mt-1 text-base font-semibold text-slate-900" />
            </div>
          ) : null}
          {hours.length ? (
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Hours</p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                {hours.map((row) => (
                  <div key={`${row.label}-${row.value}`} className="rounded-2xl border border-slate-100 bg-white/90 px-4 py-3 shadow-sm">
                    <dt className="text-sm font-medium text-slate-500">{row.label}</dt>
                    <dd className="text-lg font-semibold text-slate-900">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
          {parking ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              <p className="font-semibold text-slate-900">Parking & access</p>
              <RichText value={parking} />
            </div>
          ) : null}
        </div>
        <div className="relative overflow-hidden rounded-3xl border border-slate-100 bg-slate-900/90 shadow-xl">
          {mapEmbedUrl ? (
            <iframe
              src={mapEmbedUrl}
              title="Location map"
              loading="lazy"
              className="h-[420px] w-full border-0"
              allowFullScreen
            />
          ) : mapImage?.src ? (
            <img
              src={mapImage.src}
              alt={mapImage.alt || 'Location map'}
              className="h-[420px] w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full min-h-[360px] items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900">
              <p className="text-sm text-white/80">Map preview coming soon</p>
            </div>
          )}
          <div className="absolute inset-x-5 bottom-5 rounded-2xl bg-white/95 px-4 py-3 text-sm text-slate-600 shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-[0.4em] text-slate-400">Need directions?</p>
            <p>Tap the map or search for us on your preferred maps app.</p>
          </div>
        </div>
      </div>
    </section>
  );
};
