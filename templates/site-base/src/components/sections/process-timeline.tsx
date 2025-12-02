export type ProcessTimelineProps = {
  title: string;
  subtitle: string;
  steps: Array<{ id: string; title: string; description: string; timeline: string }>;
};

export const ProcessTimeline = ({ title, subtitle, steps }: ProcessTimelineProps) => (
  <section className="section-shell" id="process">
    <div className="mx-auto max-w-3xl text-center">
      <h2 className="text-4xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-lg text-white/70">{subtitle}</p>
    </div>
    <div className="mt-12 space-y-6">
      {steps.map((step) => (
        <div key={step.id} className="relative rounded-3xl border border-white/10 bg-gradient-to-r from-white/5 to-white/0 p-6 text-white">
          <div className="text-sm uppercase tracking-[0.2em] text-white/40">{step.timeline}</div>
          <h3 className="mt-2 text-2xl font-semibold">{step.title}</h3>
          <p className="mt-3 text-white/70">{step.description}</p>
        </div>
      ))}
    </div>
  </section>
);
