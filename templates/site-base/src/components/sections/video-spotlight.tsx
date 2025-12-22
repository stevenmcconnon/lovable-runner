import { useMemo, useState } from 'react';
import { PortableTextValue, RichText } from '../rich-text';

type VideoItem = {
  title: string;
  url?: string;
  embedUrl?: string;
  thumbnail?: string;
  description?: PortableTextValue;
  duration?: string;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  videos?: VideoItem[];
  sectionId?: string;
};

const toEmbedUrl = (item: VideoItem) => {
  if (item.embedUrl) return item.embedUrl;
  if (!item.url) return undefined;
  try {
    const url = new URL(item.url);
    if (/youtube\.com|youtu\.be/.test(url.hostname)) {
      const videoId = url.searchParams.get('v') || url.pathname.replace('/', '');
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
    }
    if (url.hostname.includes('vimeo.com')) {
      const videoId = url.pathname.replace('/', '');
      if (videoId) return `https://player.vimeo.com/video/${videoId}`;
    }
  } catch (error) {
    console.warn('[VideoSpotlight] unable to parse url', error);
  }
  return item.url;
};

export const VideoSpotlight = ({ title, subtitle, videos = [], sectionId = 'video' }: Props) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeVideo = videos[activeIndex];
  const embedUrl = useMemo(() => (activeVideo ? toEmbedUrl(activeVideo) : undefined), [activeVideo]);
  if (!videos.length) return null;
  return (
    <section className="section-shell" id={sectionId}>
      <div className="section-card grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Watch</p>
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          {subtitle ? (
            <RichText value={subtitle} className="mt-2 text-base text-slate-600" />
          ) : null}
          <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-black shadow-2xl">
            {embedUrl ? (
              <iframe
                src={embedUrl}
                title={activeVideo.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                className="aspect-video w-full"
              />
            ) : activeVideo.thumbnail ? (
              <img
                src={activeVideo.thumbnail}
                alt={activeVideo.title}
                className="aspect-video w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-slate-900 text-white">
                <span>{activeVideo.title}</span>
              </div>
            )}
          </div>
        </div>
        <div className="space-y-4">
          {videos.map((video, idx) => (
            <button
              key={video.title}
              type="button"
              onClick={() => setActiveIndex(idx)}
              className={`flex w-full items-center gap-4 rounded-3xl border px-4 py-3 text-left transition ${
                idx === activeIndex
                  ? 'border-[hsl(var(--brand))] bg-[hsl(var(--brand)/0.08)] shadow-lg'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {video.thumbnail ? (
                <img
                  src={video.thumbnail}
                  alt={video.title}
                  className="h-16 w-24 rounded-2xl object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-16 w-24 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  ▶
                </div>
              )}
              <div className="flex flex-1 flex-col">
                <p className="text-base font-semibold text-slate-900">{video.title}</p>
                {video.duration ? (
                  <p className="text-xs uppercase tracking-[0.4em] text-slate-400">{video.duration}</p>
                ) : null}
                {video.description ? (
                  <RichText value={video.description} className="text-xs text-slate-500" />
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};
