import { DatabaseService } from './database';
import { DomainService, DomainContactInput, DnsConfig } from './domain';
import { DomainOrderRecord, DomainRecord } from '../types';
import { DomainManager, PreparedEdgeMetadata } from './domain-manager';

export type DomainOrderMetadata = {
  slug: string;
  termYears: number;
  contact: DomainContactInput;
  wire?: boolean;
  dnsConfig: DnsConfig;
  edge?: PreparedEdgeMetadata;
  stripeSessionId?: string;
  paymentIntentId?: string;
  wired?: boolean;
  [key: string]: unknown;
};

type FulfillContext = {
  paymentIntentId?: string;
  stripeSessionId?: string;
};

const STATUS_PAYMENT_PENDING = 'payment_pending';
const STATUS_PROCESSING = 'processing';
const STATUS_FULFILLED = 'fulfilled';
const STATUS_WIRED = 'wired';
const STATUS_FAILED = 'failed';

export class DomainOrderService {
  constructor(
    private readonly deps: {
      db: DatabaseService;
      domainService: DomainService;
      domainManager?: DomainManager;
    }
  ) {}

  async createPendingOrder(params: {
    accountId: string;
    slug: string;
    domain: string;
    termYears?: number;
    contact: DomainContactInput;
    wire?: boolean;
    dnsConfig: DnsConfig;
    edgeMetadata?: PreparedEdgeMetadata;
    priceCents: number;
    currency?: string;
  }): Promise<DomainOrderRecord> {
    const metadata: DomainOrderMetadata = {
      slug: params.slug,
      termYears: params.termYears ?? 1,
      contact: params.contact,
      wire: params.wire ?? false,
      dnsConfig: params.dnsConfig,
      edge: params.edgeMetadata,
    };
    return this.deps.db.createDomainOrder({
      accountId: params.accountId,
      slug: params.slug,
      domain: params.domain,
      status: STATUS_PAYMENT_PENDING,
      priceCents: params.priceCents,
      currency: params.currency ?? 'USD',
      metadata,
    });
  }

  async attachStripeSession(order: DomainOrderRecord, sessionId: string): Promise<void> {
    const metadata = this.parseMetadata(order.metadata);
    metadata.stripeSessionId = sessionId;
    await this.deps.db.updateDomainOrder(order.id, {
      metadata,
    });
  }

  async fulfillOrders(orderIds: string[], context: FulfillContext = {}): Promise<void> {
    if (!orderIds.length) return;
    const records = await this.deps.db.getDomainOrdersByIds(orderIds);
    for (const record of records) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.fulfillOrder(record, context);
      } catch (error) {
        console.error('[domain-order] fulfillment failed', {
          orderId: record.id,
          err: (error as Error)?.message,
        });
        await this.deps.db.updateDomainOrder(record.id, {
          status: STATUS_FAILED,
          metadata: this.appendMetadata(record, { error: (error as Error)?.message }),
        });
      }
    }
  }

  private async fulfillOrder(order: DomainOrderRecord, context: FulfillContext): Promise<void> {
    if (!order || !order.metadata || order.status === STATUS_FULFILLED || order.status === STATUS_WIRED) {
      return;
    }
    const metadata = this.parseMetadata(order.metadata);
    if (!metadata.slug || !metadata.contact || !metadata.dnsConfig) {
      throw new Error('Domain order metadata is incomplete');
    }

    await this.deps.db.updateDomainOrder(order.id, {
      status: STATUS_PROCESSING,
      metadata: this.appendMetadata(order, {
        paymentIntentId: context.paymentIntentId ?? metadata.paymentIntentId,
        stripeSessionId: context.stripeSessionId ?? metadata.stripeSessionId,
      }),
    });

    const purchase = await this.deps.domainService.purchaseDomain({
      domain: order.domain,
      slug: metadata.slug,
      years: metadata.termYears,
      contact: metadata.contact,
    });

    const domainRecord = await this.deps.db.upsertSiteDomain({
      accountId: order.accountId ?? null,
      slug: metadata.slug,
      domain: order.domain,
      type: 'managed',
      provider: this.deps.domainService.getProviderCode(),
      status: metadata.wire ? 'configuring' : purchase.status ?? 'pending',
      verificationToken: metadata.dnsConfig.verificationToken,
      dnsSettings: metadata.dnsConfig,
    });

    if (metadata.edge && this.deps.domainManager) {
      const provisioned = await this.deps.domainManager.ensureCertificateForDomain({
        domain: order.domain,
        canonicalMode: metadata.edge.canonicalMode,
        canonicalHost: metadata.edge.canonicalHost,
      });
      const latestRecord = await this.deps.db.getDomainByName(order.domain);
      if (latestRecord) {
        await this.deps.domainManager.refreshHttps({
          ...latestRecord,
          certificateArn: provisioned.certificate?.arn ?? latestRecord.certificateArn,
        } as DomainRecord);
      }
    }

    let wired = false;
    if (metadata.wire) {
      await this.deps.domainService.wireDomain({
        domain: order.domain,
        dnsConfig: metadata.dnsConfig,
      });
      wired = true;
    }

    const nextStatus = wired ? STATUS_WIRED : STATUS_FULFILLED;
    await this.deps.db.updateDomainOrder(order.id, {
      status: nextStatus,
      providerOrderId: purchase.providerOrderId ?? null,
      metadata: this.appendMetadata(order, {
        wired,
        nameservers: purchase.nameservers,
        verification: purchase.verification,
        paymentIntentId: context.paymentIntentId ?? metadata.paymentIntentId,
        stripeSessionId: context.stripeSessionId ?? metadata.stripeSessionId,
      }),
    });

    this.logFulfillment(order, domainRecord, wired);
  }

  private parseMetadata(metadata?: Record<string, unknown> | null): DomainOrderMetadata {
    const base = (metadata || {}) as DomainOrderMetadata;
    return {
      slug: base.slug,
      termYears: base.termYears ?? 1,
      contact: base.contact,
      wire: base.wire ?? false,
      dnsConfig: base.dnsConfig,
      edge: base.edge,
      stripeSessionId: base.stripeSessionId,
      paymentIntentId: base.paymentIntentId,
      wired: base.wired,
    };
  }

  private appendMetadata(
    order: DomainOrderRecord,
    patch: Record<string, unknown>
  ): Record<string, unknown> {
    return Object.assign({}, order.metadata || {}, patch);
  }

  private logFulfillment(order: DomainOrderRecord, domain: DomainRecord, wired: boolean) {
    // eslint-disable-next-line no-console
    console.log('[domain-order] fulfilled', {
      orderId: order.id,
      domain: order.domain,
      slug: domain.slug,
      wired,
    });
  }
}
