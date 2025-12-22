export type SectionComponentId =
  | 'site-navigation'
  | 'hero-with-image'
  | 'features-grid'
  | 'hours-location'
  | 'trust-badges'
  | 'logo-wall'
  | 'testimonials-cards'
  | 'faq-accordion'
  | 'pricing-table'
  | 'product-grid'
  | 'cta-banner'
  | 'process-timeline'
  | 'stats-showcase'
  | 'gallery-carousel'
  | 'team-grid'
  | 'case-studies'
  | 'contact-form'
  | 'booking-widget'
  | 'reservation-widget'
  | 'menu-grid'
  | 'inventory-list'
  | 'video-spotlight'
  | 'lead-magnet'
  | 'sticky-cta-bar'
  | 'footer-links'
  | 'review-collector';

export type SectionConfig<TProps = Record<string, unknown>> = {
  id: string;
  componentId: SectionComponentId;
  props: TProps;
};

export type ImageAsset = {
  src: string;
  alt?: string;
  generatedAt?: string;
  caption?: string;
  credit?: string;
  creditUrl?: string;
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
  cornerStyle?: 'rounded' | 'sharp';
  textColor?: string;
  displayFont?: string;
  bodyFont?: string;
  styleProfile?: 'rounded-elevated' | 'sharp-minimal' | 'full-bleed';
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
  slug?: string;
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
