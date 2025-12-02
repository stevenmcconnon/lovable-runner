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
      <h2 className="mt-3 text-4xl font-semibold text-white">{title}</h2>
      <p className="mt-4 text-lg text-white/70">{subtitle}</p>
    </div>
    <div className="mt-12 grid gap-6 lg:grid-cols-3">
      {tiers.map((tier) => (
        <div key={tier.name} className="flex flex-col rounded-3xl border border-white/10 bg-white/5 p-8 text-white">
          <p className="text-sm uppercase tracking-[0.2em] text-white/50">{tier.name}</p>
          <p className="mt-4 text-4xl font-bold">{tier.price}</p>
          <p className="mt-2 text-white/70">{tier.description}</p>
          <ul className="mt-6 space-y-2 text-sm text-white/80">
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
