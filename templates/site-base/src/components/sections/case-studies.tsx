import { Card } from '../ui/card';
import { PortableTextValue, RichText } from '../rich-text';

type CaseStudy = {
  title: PortableTextValue;
  summary: PortableTextValue;
  metricLabel?: string;
  metricValue?: string;
  industry?: string;
  result?: string;
  cta?: { label: string; href: string };
};

export type CaseStudiesProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  cases: CaseStudy[];
};

export const CaseStudies = ({ title, subtitle, cases }: CaseStudiesProps) => {
  if (!Array.isArray(cases) || cases.length === 0) return null;
  return (
    <section className="section-shell" id="case-studies">
      <div className="section-card space-y-10">
        <div className="space-y-4 text-center">
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          <RichText
            value={subtitle}
            className="mx-auto max-w-3xl text-base text-[hsl(var(--surface-foreground)/0.7)] md:text-lg"
          />
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {cases.map((study, idx) => (
            <Card
              key={idx}
              className="flex h-full flex-col justify-between space-y-4 bg-gradient-to-br from-white/90 via-white/70 to-[hsl(var(--brand)/0.05)]"
            >
              <div className="space-y-3">
                {study.industry ? (
                  <p className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--surface-foreground)/0.5)]">
                    {study.industry}
                  </p>
                ) : null}
                <RichText value={study.title} as="h3" className="text-2xl font-semibold" />
                <RichText
                  value={study.summary}
                  className="text-sm leading-relaxed text-[hsl(var(--surface-foreground)/0.75)]"
                />
              </div>
              <div className="space-y-4">
                {(study.metricLabel || study.metricValue) && (
                  <div className="rounded-2xl bg-[hsl(var(--brand)/0.08)] px-4 py-3 text-[hsl(var(--brand))]">
                    <p className="text-base font-semibold">
                      {study.metricValue} <span className="text-xs text-[hsl(var(--surface-foreground)/0.7)]">{study.metricLabel}</span>
                    </p>
                    {study.result ? (
                      <p className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--surface-foreground)/0.5)]">
                        {study.result}
                      </p>
                    ) : null}
                  </div>
                )}
                {study.cta ? (
                  <a
                    href={study.cta.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex w-full items-center justify-center rounded-full border border-[hsl(var(--surface-foreground)/0.2)] px-6 py-3 text-sm font-semibold text-[hsl(var(--surface-foreground))] transition hover:bg-[hsl(var(--surface-foreground)/0.06)]"
                  >
                    {study.cta.label}
                  </a>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
