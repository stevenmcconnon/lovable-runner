import { cn } from '../../lib/cn';
import type { ImageAsset } from '../../content/site-schema';
import { useImageModal } from './image-modal';

type LightboxImageProps = {
  image?: ImageAsset | null;
  className?: string;
  rounded?: string;
  showBadge?: boolean;
  overlayLabel?: string;
};

export const LightboxImage = ({
  image,
  className,
  rounded = 'rounded-2xl',
  showBadge = true,
  overlayLabel = 'View',
}: LightboxImageProps) => {
  const { open } = useImageModal();
  if (!image?.src) return null;
  const handleOpen = () =>
    open({
      src: image.src,
      alt: image.alt,
      caption: image.caption,
      credit: image.credit,
    });
  return (
    <button
      type="button"
      onClick={handleOpen}
      className={cn(
        'group relative block overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--brand))]',
        rounded,
        className
      )}
    >
      <img
        src={image.src}
        alt={image.alt || 'Preview image'}
        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
        loading="lazy"
      />
      {showBadge ? (
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-white opacity-0 transition group-hover:opacity-100">
          {overlayLabel}
        </span>
      ) : null}
    </button>
  );
};
