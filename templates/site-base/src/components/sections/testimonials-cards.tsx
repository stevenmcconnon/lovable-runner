import { Card } from '../ui/card';

export type TestimonialsCardsProps = {
  title: string;
  subtitle: string;
  testimonials: Array<{
    name: string;
    role: string;
    quote: string;
    highlight: string;
  }>;
};

export const TestimonialsCards = ({ title, subtitle, testimonials }: TestimonialsCardsProps) => (
  <section className="section-shell" id="reviews">
    <div className="mx-auto max-w-4xl text-center">
      <h2 className="text-4xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-lg text-white/70">{subtitle}</p>
    </div>
    <div className="mt-12 grid gap-6 md:grid-cols-3">
      {testimonials.map((testimonial) => (
        <Card key={testimonial.name} className="h-full bg-white/[0.07]">
          <p className="text-sm font-semibold uppercase tracking-widest text-[hsl(var(--brand-accent))]">
            {testimonial.highlight}
          </p>
          <p className="mt-4 text-lg text-white/90">“{testimonial.quote}”</p>
          <div className="mt-6 text-sm text-white/70">
            <p className="font-semibold text-white">{testimonial.name}</p>
            <p>{testimonial.role}</p>
          </div>
        </Card>
      ))}
    </div>
  </section>
);
