import path from 'node:path';
import { DatabaseService } from './database';

const rootRequire = (relativePath: string): any => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(process.cwd(), relativePath));
  } catch {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', '..', relativePath));
  }
};

const { enqueueNotificationJob } = rootRequire('src/notification-jobs.js') as {
  enqueueNotificationJob: (params: {
    slug: string;
    recipient: string;
    template: string;
    subject: string;
    bodyText: string;
    bodyHtml?: string | null;
    metadata?: Record<string, unknown> | null;
    dedupeKey?: string | null;
  }) => Promise<any>;
};

type Recipient = { email: string; userId?: string };

type NotificationPayload = {
  slug: string;
  template: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  metadata?: Record<string, unknown>;
  dedupeKey: string;
};

const formatLink = (url?: string | null) => {
  if (!url) return '';
  return `<p style="margin:16px 0;"><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>`;
};

export class NotificationService {
  constructor(private readonly deps: { db: DatabaseService }) {}

  private async resolveAccountRecipients(accountId?: string | null): Promise<Recipient[]> {
    if (!accountId) return [];
    const users = await this.deps.db.listUsersAdmin({ accountId });
    const seen = new Set<string>();
    const recipients: Recipient[] = [];
    users.forEach((user) => {
      if (!user.roles.some((role) => role === 'customer' || role === 'admin')) return;
      const email = user.email?.trim().toLowerCase();
      if (!email || seen.has(email)) return;
      seen.add(email);
      recipients.push({ email, userId: user.id });
    });
    return recipients;
  }

  private async dispatchToAccount(
    accountId: string | null | undefined,
    payload: NotificationPayload
  ): Promise<void> {
    const recipients = await this.resolveAccountRecipients(accountId);
    if (!recipients.length) return;
    await Promise.all(
      recipients.map(async (recipient) => {
        try {
          await enqueueNotificationJob({
            slug: payload.slug,
            recipient: recipient.email,
            template: payload.template,
            subject: payload.subject,
            bodyText: payload.bodyText,
            bodyHtml: payload.bodyHtml,
            metadata: payload.metadata ?? null,
            dedupeKey: `${payload.dedupeKey}:${recipient.email}`,
          });
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('[notifications] Failed to enqueue job', {
            slug: payload.slug,
            template: payload.template,
            err: (error as Error)?.message,
          });
        }
      })
    );
  }

  async notifyDeploymentComplete(params: {
    slug: string;
    accountId?: string | null;
    target: 'live' | 'preview';
    publicUrl?: string | null;
  }): Promise<void> {
    const { slug, accountId, target, publicUrl } = params;
    const subject =
      target === 'live'
        ? `Your ${slug} site is live`
        : `Preview updated for ${slug}`;
    const upperTarget = target.toUpperCase();
    const bodyTextLines = [
      `We just finished publishing ${slug} to ${upperTarget}.`,
      publicUrl ? `View it here: ${publicUrl}` : null,
      '',
      'If you did not request this publish, please review your account activity.',
    ].filter(Boolean) as string[];
    const bodyHtml = [
      `<p style="margin:0 0 12px;">We just finished publishing <strong>${slug}</strong> to <strong>${upperTarget}</strong>.</p>`,
      formatLink(publicUrl),
      '<p style="margin:16px 0 0;">If you did not request this publish, please review your account activity.</p>',
    ].join('');
    await this.dispatchToAccount(accountId, {
      slug,
      template: 'site-publish-complete',
      subject,
      bodyText: bodyTextLines.join('\n'),
      bodyHtml,
      metadata: { slug, target, publicUrl },
      dedupeKey: `deploy:${slug}:${target}`,
    });
  }

  async notifyDomainPurchase(params: {
    slug: string;
    accountId?: string | null;
    domain: string;
    wired: boolean;
    autoWireRequested: boolean;
  }): Promise<void> {
    const { slug, accountId, domain, wired, autoWireRequested } = params;
    const subject = wired
      ? `Domain ${domain} connected to ${slug}`
      : `Domain ${domain} purchased for ${slug}`;
    const instructions = wired
      ? 'We wired DNS automatically. HTTPS will finish provisioning shortly (usually a few minutes).'
      : 'Please finish DNS setup from your dashboard so we can enable HTTPS.';
    const bodyText = [
      `We registered ${domain} for ${slug}.`,
      instructions,
      autoWireRequested && !wired
        ? 'Automatic wiring was skipped, so records still need to be added manually.'
        : null,
    ]
      .filter(Boolean)
      .join('\n');
    const bodyHtml = [
      `<p style="margin:0 0 12px;">We registered <strong>${domain}</strong> for <strong>${slug}</strong>.</p>`,
      `<p style="margin:0 0 12px;">${instructions}</p>`,
      autoWireRequested && !wired
        ? '<p style="margin:0 0 12px;">Automatic wiring was skipped, so DNS records still need to be added manually.</p>'
        : '',
    ].join('');
    await this.dispatchToAccount(accountId, {
      slug,
      template: 'domain-purchase',
      subject,
      bodyText,
      bodyHtml,
      metadata: { slug, domain, wired, autoWireRequested },
      dedupeKey: `domain-purchase:${domain}:${wired ? 'wired' : 'pending'}`,
    });
  }

  async notifyDomainWireFailure(params: {
    slug: string;
    accountId?: string | null;
    domain: string;
    error?: string;
  }): Promise<void> {
    const { slug, accountId, domain, error } = params;
    const bodyText = [
      `We registered ${domain} for ${slug}, but automatic wiring failed.`,
      'Please visit the dashboard to review the DNS instructions and try again.',
      error ? `Error: ${error}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const bodyHtml = [
      `<p style="margin:0 0 12px;">We registered <strong>${domain}</strong> for <strong>${slug}</strong>, but automatic wiring failed.</p>`,
      '<p style="margin:0 0 12px;">Please visit the dashboard to review the DNS instructions and try again.</p>',
      error ? `<p style="color:#b91c1c;margin:0;">Error: ${error}</p>` : '',
    ].join('');
    await this.dispatchToAccount(accountId, {
      slug,
      template: 'domain-wire-failed',
      subject: `Action required: wiring failed for ${domain}`,
      bodyText,
      bodyHtml,
      metadata: { slug, domain, error },
      dedupeKey: `domain-wire-failed:${domain}`,
    });
  }

  async notifyHttpsLive(params: {
    slug: string;
    accountId?: string | null;
    domain: string;
  }): Promise<void> {
    const { slug, accountId, domain } = params;
    const publicUrl = `https://${domain}`;
    const bodyText = [
      `HTTPS is live for ${domain}.`,
      'Your site is now being served securely at CloudFront.',
      `View it here: ${publicUrl}`,
    ].join('\n');
    const bodyHtml = [
      `<p style="margin:0 0 12px;">HTTPS is live for <strong>${domain}</strong>.</p>`,
      '<p style="margin:0 0 12px;">Your site is now being served securely at CloudFront.</p>',
      formatLink(publicUrl),
    ].join('');
    await this.dispatchToAccount(accountId, {
      slug,
      template: 'domain-https-live',
      subject: `HTTPS is live for ${domain}`,
      bodyText,
      bodyHtml,
      metadata: { slug, domain },
      dedupeKey: `domain-https:${domain}`,
    });
  }
}
