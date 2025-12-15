import { Card } from '../ui/card';
import type { ImageAsset } from '../../content/site-schema';
import { PortableTextValue, RichText } from '../rich-text';

type SocialLink = { label: string; href: string };

type TeamMember = {
  name: string;
  role: string;
  bio: PortableTextValue;
  image?: ImageAsset;
  socials?: SocialLink[];
};

export type TeamGridProps = {
  title: PortableTextValue;
  subtitle: PortableTextValue;
  members: TeamMember[];
};

export const TeamGrid = ({ title, subtitle, members }: TeamGridProps) => {
  if (!Array.isArray(members) || members.length === 0) return null;
  return (
    <section className="section-shell" id="team">
      <div className="section-card space-y-10">
        <div className="space-y-4 text-center">
          <RichText value={title} as="h2" className="text-3xl font-semibold md:text-4xl" />
          <RichText
            value={subtitle}
            className="mx-auto max-w-3xl text-base text-[hsl(var(--surface-foreground)/0.7)] md:text-lg"
          />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {members.map((member) => (
            <Card key={member.name} className="flex flex-col gap-5 bg-white/80">
              <div className="flex items-center gap-4">
                {member.image?.src ? (
                  <img
                    src={member.image.src}
                    alt={member.image.alt || member.name}
                    className="h-20 w-20 rounded-2xl object-cover shadow-lg"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[hsl(var(--brand)/0.1)] text-2xl font-semibold text-[hsl(var(--brand))]">
                    {member.name
                      .split(' ')
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join('')}
                  </div>
                )}
                <div>
                  <p className="text-xl font-semibold text-[hsl(var(--surface-foreground))]">
                    {member.name}
                  </p>
                  <p className="text-sm uppercase tracking-[0.3em] text-[hsl(var(--surface-foreground)/0.5)]">
                    {member.role}
                  </p>
                </div>
              </div>
              <RichText value={member.bio} className="text-sm text-[hsl(var(--surface-foreground)/0.8)]" />
              {Array.isArray(member.socials) && member.socials.length ? (
                <div className="flex flex-wrap gap-3 text-sm">
                  {member.socials.map((social) => (
                    <a
                      key={`${member.name}-${social.label}`}
                      href={social.href}
                      className="rounded-full border border-[hsl(var(--surface-foreground)/0.12)] px-4 py-1 text-[hsl(var(--brand))] underline-offset-4 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {social.label}
                    </a>
                  ))}
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
