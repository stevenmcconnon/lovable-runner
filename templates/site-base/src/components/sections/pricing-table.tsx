import { Button } from '../ui/button';

export type PricingTableProps = {
  title: string;
  subtitle: string;
  tiers: Array<{
    name: string;
    description: string;
    price: string;
    features: string[];
    ctaLabel: string;
  }>;
};

export const PricingTable = ({ title, subtitle, tiers }: PricingTableProps) => (
  <section className="section-shell" id="pricing">
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--brand-accent))]">Plans</p>
      <h2 className="mt-3 text-4xl font-semibold text-[hsl(var(--surface-foreground))]">{title}</h2>
      <p className="mt-4 text-lg text-[hsl(var(--surface-foreground)/0.75)]">{subtitle}</p>
    </div>
    <div className="mt-12 grid gap-6 lg:grid-cols-3">
      {tiers.map((tier) => (
        <div
          key={tier.name}
          className="flex flex-col rounded-3xl border border-[hsl(var(--brand)/0.35)] bg-[hsl(var(--brand)/0.09)]/80 p-8 text-[hsl(var(--surface-foreground))] shadow-lg shadow-[hsl(var(--brand)/0.2)]/45"
        >
          <p className="text-sm uppercase tracking-[0.2em] text-[hsl(var(--surface-foreground)/0.6)]">{tier.name}</p>
          <p className="mt-4 text-4xl font-bold">{tier.price}</p>
          <p className="mt-2 text-[hsl(var(--surface-foreground)/0.75)]">{tier.description}</p>
          <ul className="mt-6 space-y-2 text-sm text-[hsl(var(--surface-foreground)/0.85)]">
            {tier.features.map((feature) => (
              <li key={feature} className="flex items-center gap-2">
                <span className="text-[hsl(var(--brand))]">•</span>
                {feature}
              </li>
            ))}
          </ul>
          <Button className="mt-8 w-full">{tier.ctaLabel}</Button>
        </div>
      ))}
    </div>
  </section>
);
