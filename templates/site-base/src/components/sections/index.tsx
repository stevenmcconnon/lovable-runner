import { HeroWithImage } from './hero-with-image';
import { FeaturesGrid } from './features-grid';
import { LogoWall } from './logo-wall';
import { TestimonialsCards } from './testimonials-cards';
import { FAQAccordion } from './faq-accordion';
import { PricingTable } from './pricing-table';
import { CTABanner } from './cta-banner';
import { ProcessTimeline } from './process-timeline';
import { StatsShowcase } from './stats-showcase';
import { GalleryCarousel } from './gallery-carousel';
import { TeamGrid } from './team-grid';
import { CaseStudies } from './case-studies';
import { ContactForm } from './contact-form';
import type { SectionComponentId, SectionConfig } from '../../content/site-schema';

const REGISTRY: Record<SectionComponentId, (props: any) => JSX.Element | null> = {
  'hero-with-image': HeroWithImage,
  'features-grid': FeaturesGrid,
  'logo-wall': LogoWall,
  'testimonials-cards': TestimonialsCards,
  'faq-accordion': FAQAccordion,
  'pricing-table': PricingTable,
  'cta-banner': CTABanner,
  'process-timeline': ProcessTimeline,
  'stats-showcase': StatsShowcase,
  'gallery-carousel': GalleryCarousel,
  'team-grid': TeamGrid,
  'case-studies': CaseStudies,
  'contact-form': ContactForm,
};

export const SectionRenderer = ({ sections }: { sections: SectionConfig[] }) => (
  <div>
    {sections.map((section) => {
      const Component = REGISTRY[section.componentId as SectionComponentId];
      if (!Component) return null;
      return <Component key={section.id} {...section.props} />;
    })}
  </div>
);

export const SECTION_REGISTRY = Object.keys(REGISTRY);
