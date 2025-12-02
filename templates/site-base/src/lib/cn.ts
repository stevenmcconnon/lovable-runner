export const cn = (...classes: Array<string | undefined | false | null>) =>
  classes.filter(Boolean).join(' ');
