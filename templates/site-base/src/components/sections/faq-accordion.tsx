import { Accordion } from '../ui/accordion';

export type FAQAccordionProps = {
  title: string;
  subtitle: string;
  faqs: Array<{ id: string; question: string; answer: string }>;
};

export const FAQAccordion = ({ title, subtitle, faqs }: FAQAccordionProps) => (
  <section className="section-shell" id="faq">
    <div className="mx-auto max-w-3xl text-center">
      <h2 className="text-4xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-lg text-white/70">{subtitle}</p>
    </div>
    <div className="mt-10">
      <Accordion items={faqs} />
    </div>
  </section>
);
