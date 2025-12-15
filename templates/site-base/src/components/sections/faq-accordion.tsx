import { Accordion } from '../ui/accordion';
import { PortableTextValue, RichText } from '../rich-text';

export type FAQAccordionProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  faqs: Array<{ id: string; question: PortableTextValue; answer: PortableTextValue }>;
};

export const FAQAccordion = ({ title, subtitle, faqs }: FAQAccordionProps) => (
  <section className="section-shell" id="faq">
    <div className="mx-auto max-w-3xl text-center">
      <RichText
        value={title}
        as="h2"
        className="text-4xl font-semibold text-[hsl(var(--surface-foreground))]"
      />
      <RichText
        value={subtitle}
        className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.75)]"
      />
    </div>
    <div className="mt-10">
      <Accordion items={faqs} />
    </div>
  </section>
);
