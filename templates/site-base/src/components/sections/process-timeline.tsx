import { PortableTextValue, RichText } from '../rich-text';

export type ProcessTimelineProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  steps: Array<{ id: string; title: PortableTextValue; description: PortableTextValue; timeline: string }>;
};

export const ProcessTimeline = ({ title, subtitle, steps }: ProcessTimelineProps) => (
  <section className="section-shell" id="process">
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
    <div className="mt-12 space-y-6">
      {steps.map((step) => (
        <div
          key={step.id}
          className="relative rounded-3xl border border-[hsl(var(--brand)/0.35)] bg-gradient-to-r from-[hsl(var(--brand)/0.15)] via-white/10 to-[hsl(var(--brand-accent)/0.12)] p-6 text-[hsl(var(--surface-foreground))] shadow-lg shadow-[hsl(var(--brand)/0.2)]/50"
        >
          <div className="text-sm uppercase tracking-[0.2em] text-[hsl(var(--surface-foreground)/0.5)]">{step.timeline}</div>
          <RichText
            value={step.title}
            as="h3"
            className="mt-2 text-2xl font-semibold"
          />
          <RichText
            value={step.description}
            className="mt-3 text-[hsl(var(--surface-foreground)/0.75)]"
          />
        </div>
      ))}
    </div>
  </section>
);
