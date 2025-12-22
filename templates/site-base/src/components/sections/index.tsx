import { SiteNavigation } from './site-navigation';
import { HeroWithImage } from './hero-with-image';
import { FeaturesGrid } from './features-grid';
import { HoursLocation } from './hours-location';
import { TrustBadges } from './trust-badges';
import { LogoWall } from './logo-wall';
import { TestimonialsCards } from './testimonials-cards';
import { FAQAccordion } from './faq-accordion';
import { PricingTable } from './pricing-table';
import { ProductGrid } from './product-grid';
import { CTABanner } from './cta-banner';
import { ProcessTimeline } from './process-timeline';
import { StatsShowcase } from './stats-showcase';
import { GalleryCarousel } from './gallery-carousel';
import { TeamGrid } from './team-grid';
import { CaseStudies } from './case-studies';
import { ContactForm } from './contact-form';
import { BookingWidget } from './booking-widget';
import { ReservationWidget } from './reservation-widget';
import { MenuGrid } from './menu-grid';
import { InventoryList } from './inventory-list';
import { VideoSpotlight } from './video-spotlight';
import { LeadMagnet } from './lead-magnet';
import { StickyCtaBar } from './sticky-cta-bar';
import { FooterLinks } from './footer-links';
import { ReviewCollector } from './review-collector';
import type { SectionComponentId, SectionConfig } from '../../content/site-schema';

const REGISTRY: Record<SectionComponentId, (props: any) => JSX.Element | null> = {
  'site-navigation': SiteNavigation,
  'hero-with-image': HeroWithImage,
  'features-grid': FeaturesGrid,
  'hours-location': HoursLocation,
  'trust-badges': TrustBadges,
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
  'product-grid': ProductGrid,
  'contact-form': ContactForm,
  'booking-widget': BookingWidget,
  'reservation-widget': ReservationWidget,
  'menu-grid': MenuGrid,
  'inventory-list': InventoryList,
  'video-spotlight': VideoSpotlight,
  'lead-magnet': LeadMagnet,
  'sticky-cta-bar': StickyCtaBar,
  'footer-links': FooterLinks,
  'review-collector': ReviewCollector,
};

export const SectionRenderer = ({ sections }: { sections: SectionConfig[] }) => (
  <div>
    {sections.map((section) => {
      const Component = REGISTRY[section.componentId as SectionComponentId];
      if (!Component) return null;
      return (
        <Component
          key={section.id}
          {...section.props}
          sectionId={section.id}
          componentId={section.componentId}
        />
      );
    })}
  </div>
);

export const SECTION_REGISTRY = Object.keys(REGISTRY);
