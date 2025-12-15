const STYLE_PROFILES = [
  {
    id: 'rounded-elevated',
    label: 'Rounded elevated cards',
    description: 'Soft, rounded panels with glassy gradients and deep shadows for premium service brands.',
  },
  {
    id: 'sharp-minimal',
    label: 'Sharp minimal layout',
    description: 'Squared edges, crisp dividers, and light surfaces for tech/SaaS and modern corporate looks.',
  },
  {
    id: 'full-bleed',
    label: 'Full-bleed showcase',
    description: 'Edge-to-edge sections with light overlays so imagery and galleries feel immersive.',
  },
];

const STYLE_PROFILE_IDS = STYLE_PROFILES.map((profile) => profile.id);

const describeStyleProfiles = () =>
  STYLE_PROFILES.map((profile) => `- ${profile.id}: ${profile.description}`).join('\n');

module.exports = {
  STYLE_PROFILES,
  STYLE_PROFILE_IDS,
  describeStyleProfiles,
};
