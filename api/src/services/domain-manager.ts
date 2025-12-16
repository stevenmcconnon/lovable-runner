import { DatabaseService } from './database';
import { DnsConfig, DnsRecord } from './domain';
import { CanonicalMode, CertificateInfo, DomainEdgeService, ValidationRecord as EdgeValidationRecord } from './domain-edge';
import { DomainRecord } from '../types';

export type PreparedEdgeMetadata = {
  canonicalMode: CanonicalMode;
  canonicalHost: string;
  certificate: CertificateInfo;
};

export class DomainManager {
  constructor(
    private readonly deps: {
      db: DatabaseService;
      edge: DomainEdgeService;
    }
  ) {}

  async prepareDnsConfig(params: {
    domain: string;
    slug: string;
    dnsConfig: DnsConfig;
    canonicalMode?: CanonicalMode;
  }): Promise<{ dnsConfig: DnsConfig; metadata: PreparedEdgeMetadata }> {
    const canonicalMode = this.deps.edge.getCanonicalMode(params.canonicalMode);
    const canonicalHost = this.deps.edge.deriveCanonicalHost(params.domain, canonicalMode);
    const certificate = await this.deps.edge.ensureCertificate(params.domain);
    const validationRecords = certificate.validationRecords.map((record) =>
      this.toDnsRecord(record, params.domain)
    );
    const mergedRecords = this.mergeRecords(params.dnsConfig.records || [], validationRecords);
    const enrichedConfig: DnsConfig = {
      ...params.dnsConfig,
      records: mergedRecords,
    };
    return {
      dnsConfig: enrichedConfig,
      metadata: {
        canonicalHost,
        canonicalMode,
        certificate,
      },
    };
  }

  async persistEdgeMetadata(domain: string, metadata: PreparedEdgeMetadata): Promise<void> {
    const now = new Date().toISOString();
    const httpsStatus = metadata.certificate.status === 'ISSUED' ? 'provisioning' : 'validating';
    await this.deps.db.updateSiteDomain(domain, {
      canonicalHost: metadata.canonicalHost,
      canonicalMode: metadata.canonicalMode,
      certificateArn: metadata.certificate.arn,
      certificateStatus: metadata.certificate.status,
      certificateStatusAt: now,
      certificateValidation: metadata.certificate.validationRecords,
      httpsStatus,
      httpsCheckedAt: now,
    });
  }

  async refreshHttps(record: DomainRecord): Promise<DomainRecord | null> {
    if (!record.domain) return null;
    const now = new Date().toISOString();
    const patch: Partial<DomainRecord> = {
      httpsCheckedAt: now,
    };
    let dirty = false;
    const canonicalMode = this.deps.edge.getCanonicalMode(record.canonicalMode);
    const canonicalHost =
      record.canonicalHost || this.deps.edge.deriveCanonicalHost(record.domain, canonicalMode);
    if (record.certificateArn) {
      try {
        const certificate = await this.deps.edge.describeCertificate(record.certificateArn);
        patch.certificateStatus = certificate.status;
        patch.certificateStatusAt = now;
        patch.certificateValidation = certificate.validationRecords;
        dirty = true;
        if (certificate.status !== 'ISSUED') {
          patch.httpsStatus = 'validating';
        } else if (!record.edgeDistributionId) {
          const redirectFn = await this.deps.edge.ensureRedirectFunction(canonicalHost);
          const aliases = this.deps.edge.buildAliasList(record.domain);
          const distribution = await this.deps.edge.ensureDistribution({
            domain: record.domain,
            slug: record.slug,
            certificateArn: certificate.arn,
            aliases,
            canonicalHost,
            redirectFunctionArn: redirectFn.arn,
          });
          patch.edgeFunctionName = redirectFn.name;
          patch.edgeFunctionArn = redirectFn.arn;
          patch.edgeDistributionId = distribution.id;
          patch.edgeDomain = distribution.domainName;
          patch.edgeStatus = distribution.status;
          patch.edgeStatusAt = now;
          patch.httpsStatus = distribution.status === 'Deployed' ? 'live' : 'provisioning';
          if (distribution.status === 'Deployed') {
            patch.httpsReadyAt = now;
            patch.routingError = null;
          }
        }
      } catch (error: any) {
        patch.routingError = error?.message || 'Unable to describe certificate';
        dirty = true;
      }
    }

    if (record.edgeDistributionId) {
      try {
        const distribution = await this.deps.edge.getDistribution(record.edgeDistributionId);
        if (distribution) {
          patch.edgeStatus = distribution.status;
          patch.edgeStatusAt = now;
          dirty = true;
          if (distribution.status === 'Deployed') {
            patch.httpsStatus = 'live';
            patch.httpsReadyAt = patch.httpsReadyAt ?? now;
            patch.routingError = null;
          }
        }
      } catch (error: any) {
        patch.routingError = error?.message || 'Unable to fetch distribution status';
        dirty = true;
      }
    }

    if (!dirty) return null;
    return this.deps.db.updateSiteDomain(record.domain, patch);
  }

  private toDnsRecord(record: EdgeValidationRecord, domain: string): DnsRecord {
    const host = this.deriveRelativeName(record.name, domain);
    return {
      type: record.type || 'CNAME',
      host,
      value: record.value,
      ttl: 300,
    };
  }

  private deriveRelativeName(fullName: string, domain: string): string {
    if (!fullName) return '@';
    const trimmed = fullName.replace(/\.$/, '').toLowerCase();
    const base = domain.toLowerCase();
    if (trimmed === base) return '@';
    if (trimmed.endsWith(`.${base}`)) {
      const relative = trimmed.slice(0, trimmed.length - base.length - 1);
      return relative || '@';
    }
    return trimmed;
  }

  private mergeRecords(existing: DnsRecord[], additions: DnsRecord[]): DnsRecord[] {
    const map = new Map<string, DnsRecord>();
    const addRecord = (record: DnsRecord) => {
      const key = `${record.type}:${record.host}:${record.value}`.toLowerCase();
      if (!map.has(key)) {
        map.set(key, record);
      }
    };
    existing.forEach((record) => addRecord(record));
    additions.forEach((record) => addRecord(record));
    return Array.from(map.values());
  }
}
