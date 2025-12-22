import { PortableTextValue, RichText } from '../rich-text';

type MenuTag = {
  label: string;
  variant?: 'spicy' | 'vegan' | 'new' | 'chef';
};

type MenuItem = {
  name: string;
  description?: PortableTextValue;
  price?: string;
  tags?: MenuTag[];
  highlight?: string;
};

type MenuCategory = {
  name: string;
  description?: PortableTextValue;
  items?: MenuItem[];
};

type Props = {
  title: PortableTextValue;
  subtitle?: PortableTextValue;
  categories?: MenuCategory[];
  sectionId?: string;
};

const TagPill = ({ tag }: { tag: MenuTag }) => {
  const palette: Record<MenuTag['variant'], string> = {
    spicy: 'bg-red-100 text-red-700',
    vegan: 'bg-emerald-100 text-emerald-700',
    new: 'bg-indigo-100 text-indigo-700',
    chef: 'bg-amber-100 text-amber-700',
  } as const;
  const classes = palette[tag.variant || 'new'] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>
      {tag.label}
    </span>
  );
};

export const MenuGrid = ({ title, subtitle, categories = [], sectionId = 'menu' }: Props) => {
  if (!categories.length) return null;
  return (
    <section className="section-shell" id={sectionId}>
      <div className="section-card">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Menu</p>
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          {subtitle ? (
            <RichText value={subtitle} className="text-base text-slate-600" />
          ) : null}
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {categories.map((category) => (
            <div key={category.name} className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <p className="text-xl font-semibold text-slate-900">{category.name}</p>
                {category.description ? (
                  <RichText value={category.description} className="text-sm text-slate-500" />
                ) : null}
              </div>
              <div className="mt-5 space-y-4">
                {(category.items || []).map((item) => (
                  <div key={item.name} className="rounded-2xl border border-transparent p-3 transition hover:border-slate-200 hover:bg-slate-50">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-base font-semibold text-slate-900">{item.name}</p>
                        {item.highlight ? (
                          <p className="text-xs uppercase tracking-[0.4em] text-[hsl(var(--brand))]">
                            {item.highlight}
                          </p>
                        ) : null}
                      </div>
                      {item.price ? (
                        <p className="text-sm font-semibold text-slate-700">{item.price}</p>
                      ) : null}
                    </div>
                    {item.description ? (
                      <RichText value={item.description} className="mt-1 text-sm text-slate-600" />
                    ) : null}
                    {item.tags?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {item.tags.map((tag) => (
                          <TagPill key={`${item.name}-${tag.label}`} tag={tag} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
