import { PortableTextValue, RichText } from '../rich-text';

type Badge = {
  label: string;
  description?: PortableTextValue;
  icon?: string;
  proof?: string;
};

type Guarantee = {
  title: string;
  body?: PortableTextValue;
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  badges?: Badge[];
  guarantees?: Guarantee[];
  complianceCopy?: PortableTextValue;
  sectionId?: string;
};

const iconMap: Record<string, string> = {
  shield: 'M12 3l7 4v5c0 5-3.5 9-7 10-3.5-1-7-5-7-10V7l7-4z',
  check: 'M5 13l4 4L19 7',
  star: 'M12 3l2.9 6 6.6.6-5 4.4 1.5 6.6L12 17l-6 3.6 1.5-6.6-5-4.4 6.6-.6z',
};

const BadgeCard = ({ badge }: { badge: Badge }) => {
  const path = iconMap[badge.icon || 'shield'] || iconMap.shield;
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white/95 p-5 shadow-sm shadow-slate-900/5">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[hsl(var(--brand)/0.12)] text-[hsl(var(--brand))]">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d={path} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <p className="text-base font-semibold text-slate-900">{badge.label}</p>
          {badge.proof ? <p className="text-xs uppercase tracking-[0.3em] text-slate-400">{badge.proof}</p> : null}
        </div>
      </div>
      {badge.description ? (
        <RichText value={badge.description} className="text-sm text-slate-600" />
      ) : null}
    </div>
  );
};

export const TrustBadges = ({
  title,
  subtitle,
  badges = [],
  guarantees = [],
  complianceCopy,
  sectionId = 'trust',
}: Props) => {
  if (!badges.length) return null;
  return (
    <section className="section-shell" id={sectionId}>
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="section-card">
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Trust & safety</p>
            <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
            {subtitle ? (
              <RichText value={subtitle} className="text-base text-slate-600" />
            ) : null}
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {badges.map((badge) => (
              <BadgeCard key={badge.label} badge={badge} />
            ))}
          </div>
          {guarantees.length ? (
            <div className="mt-8 grid gap-4 rounded-2xl bg-slate-900/90 p-6 text-white md:grid-cols-2">
              {guarantees.map((guarantee) => (
                <div key={guarantee.title}>
                  <p className="text-sm font-semibold uppercase tracking-[0.3em] text-white/70">
                    {guarantee.title}
                  </p>
                  {guarantee.body ? (
                    <RichText value={guarantee.body} className="mt-2 text-sm text-white/80" />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {complianceCopy ? (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-xs text-slate-500">
              <RichText value={complianceCopy} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};
