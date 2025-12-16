import { createHash } from 'node:crypto';
import {
  ACMClient,
  CertificateSummary,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from '@aws-sdk/client-acm';
import {
  CloudFrontClient,
  GetDistributionCommand,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  type DistributionConfig,
} from '@aws-sdk/client-cloudfront';

export type CanonicalMode = 'apex' | 'www';

export type ValidationRecord = {
  name: string;
  value: string;
  type: string;
};

export type CertificateInfo = {
  arn: string;
  status: string;
  statusDetail?: string;
  validationRecords: ValidationRecord[];
  subjectAlternativeNames: string[];
};

export type DistributionInfo = {
  id: string;
  domainName: string;
  status: string;
};

export type DomainEdgeOptions = {
  certificateRegion: string;
  canonicalDefault?: CanonicalMode;
  distributionId?: string | null;
};

export class DomainEdgeService {
  private readonly acm: ACMClient;

  private readonly cloudfront: CloudFrontClient;

  private readonly canonicalDefault: CanonicalMode;

  private readonly distributionId: string | null;

  constructor(options: DomainEdgeOptions) {
    this.canonicalDefault = options.canonicalDefault === 'www' ? 'www' : 'apex';
    this.distributionId = options.distributionId || null;
    this.acm = new ACMClient({
      region: options.certificateRegion || 'us-east-1',
    });
    this.cloudfront = new CloudFrontClient({
      region: 'us-east-1',
    });
  }

  getCanonicalMode(value?: string | null): CanonicalMode {
    if (value && value.toLowerCase() === 'www') return 'www';
    return this.canonicalDefault;
  }

  deriveCanonicalHost(domain: string, mode?: CanonicalMode): string {
    const normalized = this.normalizeDomain(domain);
    const apex = normalized.replace(/^www\./, '');
    if ((mode || this.canonicalDefault) === 'www') {
      return apex.startsWith('www.') ? apex : `www.${apex}`;
    }
    return apex;
  }

  buildAliasList(domain: string): string[] {
    const normalized = this.normalizeDomain(domain);
    const apex = normalized.replace(/^www\./, '');
    const aliases = new Set<string>();
    aliases.add(apex);
    aliases.add(`www.${apex}`);
    aliases.add(normalized);
    return Array.from(aliases).map((value) => value.replace(/\.$/, ''));
  }

  async ensureCertificate(domain: string): Promise<CertificateInfo> {
    const aliasTargets = this.buildAliasList(domain);
    const apex = aliasTargets[0];
    const existing = await this.findExistingCertificate(aliasTargets);
    if (existing) {
      return existing;
    }
    const idempotency = this.buildIdempotencyToken(apex);
    const request = await this.acm.send(
      new RequestCertificateCommand({
        DomainName: apex,
        SubjectAlternativeNames: aliasTargets.filter((value) => value !== apex),
        ValidationMethod: 'DNS',
        IdempotencyToken: idempotency,
        Options: {
          CertificateTransparencyLoggingPreference: 'ENABLED',
        },
      })
    );
    if (!request.CertificateArn) {
      throw new Error('ACM did not return a certificate ARN');
    }
    return this.describeCertificate(request.CertificateArn);
  }

  async describeCertificate(arn: string): Promise<CertificateInfo> {
    const response = await this.acm.send(
      new DescribeCertificateCommand({
        CertificateArn: arn,
      })
    );
    if (!response.Certificate || !response.Certificate.CertificateArn) {
      throw new Error('Certificate not found');
    }
    return this.formatCertificate(response.Certificate);
  }

  async getDistribution(id?: string | null): Promise<DistributionInfo | null> {
    const targetId = id || this.distributionId;
    if (!targetId) return null;
    const response = await this.cloudfront.send(
      new GetDistributionCommand({
        Id: targetId,
      })
    );
    if (!response.Distribution?.Id) return null;
    return {
      id: response.Distribution.Id,
      domainName: response.Distribution.DomainName ?? '',
      status: response.Distribution.Status ?? 'Unknown',
    };
  }

  async attachAliases(aliases: string[]): Promise<DistributionInfo | null> {
    if (!this.distributionId) return null;
    if (!aliases.length) return this.getDistribution();
    const configResponse = await this.cloudfront.send(
      new GetDistributionConfigCommand({
        Id: this.distributionId,
      })
    );
    const config = configResponse.DistributionConfig;
    const etag = configResponse.ETag;
    if (!config || !etag) {
      throw new Error('Unable to load CloudFront distribution config');
    }
    const aliasSet = new Set<string>(config.Aliases?.Items ?? []);
    let changed = false;
    aliases.forEach((alias) => {
      const normalized = alias.toLowerCase();
      if (!aliasSet.has(normalized)) {
        aliasSet.add(normalized);
        changed = true;
      }
    });
    if (!changed) {
      return this.getDistribution(this.distributionId);
    }
    const updatedConfig: DistributionConfig = {
      ...config,
      Aliases: {
        Quantity: aliasSet.size,
        Items: Array.from(aliasSet),
      },
    };
    const updated = await this.cloudfront.send(
      new UpdateDistributionCommand({
        Id: this.distributionId,
        IfMatch: etag,
        DistributionConfig: updatedConfig,
      })
    );
    const summary = updated.Distribution;
    return {
      id: summary?.Id ?? this.distributionId,
      domainName: summary?.DomainName ?? '',
      status: summary?.Status ?? 'InProgress',
    };
  }

  private normalizeDomain(value: string): string {
    return value.trim().toLowerCase();
  }

  private formatCertificate(detail: any): CertificateInfo {
    const validationOptions = Array.isArray(detail.DomainValidationOptions)
      ? detail.DomainValidationOptions
      : detail.DomainValidationOptions
      ? [detail.DomainValidationOptions]
      : [];
    const validationRecords: ValidationRecord[] = validationOptions
      .map((option: any) => {
        if (!option?.ResourceRecord) return null;
        return {
          name: option.ResourceRecord.Name?.replace(/\.$/, '') ?? '',
          value: option.ResourceRecord.Value?.replace(/\.$/, '') ?? '',
          type: option.ResourceRecord.Type ?? 'CNAME',
        };
      })
      .filter(
        (record: ValidationRecord | null): record is ValidationRecord =>
          Boolean(record && record.name && record.value)
      );
    return {
      arn: detail.CertificateArn,
      status: detail.Status || 'PENDING_VALIDATION',
      statusDetail: detail.Status && detail.Status.toString(),
      validationRecords,
      subjectAlternativeNames: detail.SubjectAlternativeNames || [],
    };
  }

  private async findExistingCertificate(domains: string[]): Promise<CertificateInfo | null> {
    let marker: string | undefined;
    do {
      const response = await this.acm.send(
        new ListCertificatesCommand({
          CertificateStatuses: ['PENDING_VALIDATION', 'ISSUED', 'INACTIVE'],
          NextToken: marker,
        })
      );
      marker = response.NextToken;
      const summaries: CertificateSummary[] = response.CertificateSummaryList ?? [];
      for (const summary of summaries) {
        if (!summary.CertificateArn) continue;
        const detail = await this.describeCertificate(summary.CertificateArn);
        if (!detail || !['PENDING_VALIDATION', 'ISSUED'].includes(detail.status)) continue;
        if (this.certificateMatches(detail, domains)) {
          return detail;
        }
      }
    } while (marker);
    return null;
  }

  private certificateMatches(detail: CertificateInfo, domains: string[]): boolean {
    const normalized = (detail.subjectAlternativeNames || []).map((value) => value.toLowerCase());
    if (!normalized.length) return false;
    return domains.every((domain) => normalized.includes(domain.toLowerCase()));
  }

  private buildIdempotencyToken(domain: string): string {
    return createHash('sha256').update(domain).digest('hex').slice(0, 32);
  }
}
