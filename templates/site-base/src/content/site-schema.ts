export type SectionComponentId =
  | 'hero-with-image'
  | 'features-grid'
  | 'testimonials-cards'
  | 'faq-accordion'
  | 'pricing-table'
  | 'cta-banner'
  | 'process-timeline'
  | 'stats-showcase'
  | 'gallery-carousel'
  | 'contact-form';

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
  textColor?: string;
};

export type SiteIntegrations = {
  analytics?: Array<{ type?: 'ga' | 'meta' | 'gtm' | 'other'; id?: string }>;
  chat?: { provider?: string; key?: string };
  newsletter?: { provider?: string; listId?: string; formAction?: string };
};

export type SiteSEO = {
  title: string;
  description: string;
  keywords: string[];
};

export type SiteContent = {
  templateId?: string;
  meta: SiteMeta;
  seo: SiteSEO;
  theme: SiteTheme;
  canonical?: string;
  redirects?: Array<{ from?: string; to?: string; type?: number }>;
  openGraph?: { title?: string; description?: string; imagePrompt?: string };
  schemaMarkup?: string;
  integrations?: SiteIntegrations;
  sections?: SectionConfig[];
  pages?: Array<{
    path: string;
    title: string;
    sections: SectionConfig[];
  }>;
};
