import { createHash, randomUUID } from 'node:crypto';
import {
  ACMClient,
  CertificateSummary,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from '@aws-sdk/client-acm';
import {
  CloudFrontClient,
  CreateDistributionCommand,
  CreateFunctionCommand,
  DescribeFunctionCommand,
  GetDistributionCommand,
  PublishFunctionCommand,
  UpdateFunctionCommand,
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

export type RedirectFunctionInfo = {
  name: string;
  arn: string;
};

export type DomainEdgeOptions = {
  originHostname: string;
  certificateRegion: string;
  priceClass?: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';
  canonicalDefault?: CanonicalMode;
};

const stripProtocol = (value: string) => value.replace(/^https?:\/\//i, '').replace(/\/+$/, '');

export class DomainEdgeService {
  private readonly acm: ACMClient;

  private readonly cloudfront: CloudFrontClient;

  private readonly originHostname: string;

  private readonly priceClass: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';

  private readonly canonicalDefault: CanonicalMode;

  constructor(options: DomainEdgeOptions) {
    if (!options.originHostname) {
      throw new Error('DomainEdgeService requires an origin hostname');
    }
    this.originHostname = stripProtocol(options.originHostname);
    this.priceClass = options.priceClass ?? 'PriceClass_100';
    this.canonicalDefault = options.canonicalDefault === 'www' ? 'www' : 'apex';
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

  async ensureRedirectFunction(canonicalHost: string): Promise<RedirectFunctionInfo> {
    const functionName = this.buildFunctionName(canonicalHost);
    const code = this.buildRedirectFunctionCode(canonicalHost);
    const functionConfig = {
      Comment: `Redirect ${canonicalHost} canonical host`,
      Runtime: 'cloudfront-js-1.0',
    } as const;
    let etag: string | null = null;
    try {
      const describe = await this.cloudfront.send(
        new DescribeFunctionCommand({
          Name: functionName,
          Stage: 'DEVELOPMENT',
        })
      );
      etag = describe.ETag ?? null;
    } catch (error: any) {
      if (error?.name !== 'NoSuchFunctionExists') {
        throw error;
      }
    }
    if (!etag) {
      const created = await this.cloudfront.send(
        new CreateFunctionCommand({
          Name: functionName,
          FunctionCode: Buffer.from(code),
          FunctionConfig: functionConfig,
        })
      );
      etag = created.ETag ?? null;
    } else {
      const updated = await this.cloudfront.send(
        new UpdateFunctionCommand({
          Name: functionName,
          FunctionCode: Buffer.from(code),
          FunctionConfig: functionConfig,
          IfMatch: etag,
        })
      );
      etag = updated.ETag ?? null;
    }
    if (!etag) {
      throw new Error('Unable to create or update CloudFront function');
    }
    const published = await this.cloudfront.send(
      new PublishFunctionCommand({
        Name: functionName,
        IfMatch: etag,
      })
    );
    const arn = published.FunctionSummary?.FunctionMetadata?.FunctionARN;
    if (!arn) {
      throw new Error('CloudFront did not return a function ARN');
    }
    return { name: functionName, arn };
  }

  async ensureDistribution(params: {
    domain: string;
    slug: string;
    certificateArn: string;
    aliases: string[];
    canonicalHost: string;
    redirectFunctionArn: string;
  }): Promise<DistributionInfo> {
    const originId = `origin-${params.slug}`;
    const callerReference = randomUUID();
    const distribution = await this.cloudfront.send(
      new CreateDistributionCommand({
        DistributionConfig: {
          CallerReference: callerReference,
          Comment: `AI SiteMaker domain ${params.domain}`,
          Enabled: true,
          PriceClass: this.priceClass,
          IsIPV6Enabled: true,
          Aliases: {
            Quantity: params.aliases.length,
            Items: params.aliases,
          },
          DefaultCacheBehavior: {
            TargetOriginId: originId,
            ViewerProtocolPolicy: 'redirect-to-https',
            TrustedSigners: { Enabled: false, Quantity: 0 },
            TrustedKeyGroups: { Enabled: false, Quantity: 0 },
            ForwardedValues: {
              QueryString: true,
              Cookies: {
                Forward: 'none',
              },
              Headers: { Quantity: 0 },
              QueryStringCacheKeys: { Quantity: 0 },
            },
            Compress: true,
            AllowedMethods: {
              Items: ['GET', 'HEAD', 'OPTIONS'],
              Quantity: 3,
              CachedMethods: {
                Items: ['GET', 'HEAD'],
                Quantity: 2,
              },
            },
            FunctionAssociations: {
              Quantity: 1,
              Items: [
                {
                  EventType: 'viewer-request',
                  FunctionARN: params.redirectFunctionArn,
                },
              ],
            },
          },
          Origins: {
            Quantity: 1,
            Items: [
              {
                Id: originId,
                DomainName: this.originHostname,
                OriginPath: `/${params.slug}`,
                CustomOriginConfig: {
                  OriginProtocolPolicy: 'https-only',
                  OriginSslProtocols: {
                    Quantity: 1,
                    Items: ['TLSv1.2'],
                  },
                  OriginReadTimeout: 30,
                  OriginKeepaliveTimeout: 5,
                  HTTPPort: 80,
                  HTTPSPort: 443,
                },
              },
            ],
          },
          ViewerCertificate: {
            ACMCertificateArn: params.certificateArn,
            SSLSupportMethod: 'sni-only',
            MinimumProtocolVersion: 'TLSv1.2_2021',
          },
          HttpVersion: 'http2',
          DefaultRootObject: '',
        },
      })
    );
    const summary = distribution.Distribution;
    if (!summary?.Id || !summary.DomainName) {
      throw new Error('CloudFront did not return distribution details');
    }
    return {
      id: summary.Id,
      domainName: summary.DomainName,
      status: summary.Status || 'InProgress',
    };
  }

  async getDistribution(distributionId: string): Promise<DistributionInfo | null> {
    if (!distributionId) return null;
    const response = await this.cloudfront.send(
      new GetDistributionCommand({
        Id: distributionId,
      })
    );
    const summary = response.Distribution;
    if (!summary?.Id || !summary.DomainName) return null;
    return {
      id: summary.Id,
      domainName: summary.DomainName,
      status: summary.Status || 'InProgress',
    };
  }

  private normalizeDomain(value: string): string {
    return value.trim().toLowerCase();
  }

  private buildFunctionName(canonicalHost: string): string {
    const normalized = canonicalHost.replace(/[^a-z0-9-]+/gi, '-');
    const digest = createHash('sha256').update(canonicalHost).digest('hex').slice(0, 8);
    const base = `aisite-${normalized}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const truncated = base.length > 30 ? `${base.slice(0, 30)}-${digest}` : `${base}-${digest}`;
    return truncated.slice(0, 64);
  }

  private buildRedirectFunctionCode(canonicalHost: string): string {
    return `
function handler(event) {
  var request = event.request;
  var headers = request.headers || {};
  var hostHeader = headers.host && headers.host.value ? headers.host.value.toLowerCase() : '';
  var canonical = '${canonicalHost}';
  if (hostHeader && hostHeader !== canonical) {
    var path = request.uri || '/';
    var query = '';
    var qs = request.querystring || {};
    var keys = Object.keys(qs);
    if (keys.length > 0) {
      var parts = [];
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!qs[key]) continue;
        var value = qs[key].value;
        if (value === undefined || value === null) {
          parts.push(encodeURIComponent(key));
        } else if (value === '') {
          parts.push(encodeURIComponent(key));
        } else {
          parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(value));
        }
      }
      if (parts.length > 0) {
        query = '?' + parts.join('&');
      }
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: {
        location: { value: 'https://' + canonical + path + query },
      },
    };
  }
  return request;
}
`.trim();
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
