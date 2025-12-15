import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '../../lib/cn';

export type ModalImage = {
  src: string;
  alt?: string;
  caption?: string;
  credit?: string;
};

type ImageModalContextValue = {
  open: (image: ModalImage) => void;
  close: () => void;
};

const ImageModalContext = createContext<ImageModalContextValue | null>(null);

export const useImageModal = () => {
  const ctx = useContext(ImageModalContext);
  if (!ctx) {
    throw new Error('useImageModal must be used within an ImageModalProvider');
  }
  return ctx;
};

export const ImageModalProvider = ({ children }: { children: ReactNode }) => {
  const [activeImage, setActiveImage] = useState<ModalImage | null>(null);

  const close = useCallback(() => setActiveImage(null), []);
  const open = useCallback((image: ModalImage) => setActiveImage(image), []);

  useEffect(() => {
    if (!activeImage) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [activeImage, close]);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ImageModalContext.Provider value={value}>
      {children}
      {activeImage ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-12">
          <button
            type="button"
            aria-label="Close image preview"
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg transition hover:scale-105"
            onClick={close}
          >
            ×
          </button>
          <figure className="max-h-full max-w-5xl overflow-hidden rounded-3xl bg-slate-900/60 p-4 text-center text-white shadow-2xl">
            <img
              src={activeImage.src}
              alt={activeImage.alt || 'Expanded preview'}
              className="mx-auto max-h-[70vh] w-auto rounded-2xl object-contain"
              loading="lazy"
            />
            {(activeImage.alt || activeImage.caption || activeImage.credit) ? (
              <figcaption className="mt-4 text-sm text-white/80">
                {activeImage.caption || activeImage.alt}
                {activeImage.credit ? (
                  <span className="ml-2 text-white/60">• {activeImage.credit}</span>
                ) : null}
              </figcaption>
            ) : null}
          </figure>
        </div>
      ) : null}
    </ImageModalContext.Provider>
  );
};
