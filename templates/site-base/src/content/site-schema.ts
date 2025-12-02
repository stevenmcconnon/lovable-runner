export type SectionComponentId =
  | 'hero-with-image'
  | 'features-grid'
  | 'testimonials-cards'
  | 'faq-accordion'
  | 'pricing-table'
  | 'cta-banner'
  | 'process-timeline'
  | 'stats-showcase';

export type SectionConfig<TProps = Record<string, unknown>> = {
  id: string;
  componentId: SectionComponentId;
  props: TProps;
};

export type ImageAsset = {
  src: string;
  alt?: string;
  generatedAt?: string;
};

export type SiteMeta = {
  brandName: string;
  headline: string;
  subheadline: string;
  location?: string;
  phone?: string;
  email?: string;
};

export type SiteTheme = {
  primaryColor: string;
  accentColor: string;
  backgroundStyle: 'gradient' | 'mesh' | 'texture';
  vibe: 'luxury' | 'tech' | 'playful' | 'earthy';
};

export type SiteSEO = {
  title: string;
  description: string;
  keywords: string[];
};

export type SiteContent = {
  meta: SiteMeta;
  seo: SiteSEO;
  theme: SiteTheme;
  sections: SectionConfig[];
};
