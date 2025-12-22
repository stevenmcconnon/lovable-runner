import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { config } from '../env';
import { BusinessDetailsInput } from '../types';

export class RunnerService {
  private lambda = new LambdaClient({ region: config.awsRegion });

  private readonly queueUrl = config.runner.queueUrl;

  private readonly sqs = this.queueUrl ? new SQSClient({ region: config.awsRegion }) : null;

  private async dispatchAction(payload: Record<string, unknown>) {
    if (this.queueUrl && this.sqs) {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify(payload),
        })
      );
      return { status: 'queued' };
    }
    const functionName = config.runner.functionName || process.env.AWS_LAMBDA_FUNCTION_NAME || '';
    if (!functionName) {
      throw new Error('Runner function name is not configured');
    }
    const response = await this.lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event',
        Payload: Buffer.from(JSON.stringify(payload)),
      })
    );
    if (response.FunctionError) {
      throw new Error(`Runner invocation failed: ${response.FunctionError}`);
    }
    return { status: 'queued' };
  }

  async enqueueEditJob(params: {
    jobId: string;
    editRequestId: string;
    accountId: string;
    description: string;
    siteId?: string | null;
    businessDetails?: BusinessDetailsInput;
  }) {
    await this.dispatchAction({
      action: 'RUN_EDIT_REQUEST',
      jobId: params.jobId,
      editRequestId: params.editRequestId,
      accountId: params.accountId,
      description: params.description,
      siteId: params.siteId ?? null,
      businessDetails: params.businessDetails ?? null,
    });
  }

  async runLaunchDirect(params: {
    url?: string;
    description?: string;
    businessDetails?: BusinessDetailsInput;
    requestId?: string;
    testMode?: boolean;
    slug?: string;
    prefix?: string;
    bucket?: string;
  }) {
    return this.dispatchAction({
      action: 'RUN_SITE_LAUNCH',
      url: params.url,
      description: params.description,
      businessDetails: params.businessDetails ?? null,
      requestId: params.requestId,
      testMode: params.testMode ?? false,
      slug: params.slug,
      prefix: params.prefix,
      bucket: params.bucket,
    });
  }

  async runSiteUpdate(params: {
    requestId: string;
    slug: string;
    patch?: any;
    site?: any;
    regenerateImages?: boolean;
    description?: string;
    sourceUrl?: string;
  }) {
    return this.dispatchAction({
      action: 'RUN_SITE_UPDATE',
      requestId: params.requestId,
      slug: params.slug,
      patch: params.patch ?? null,
      site: params.site ?? null,
      regenerateImages: params.regenerateImages ?? false,
      description: params.description ?? null,
      sourceUrl: params.sourceUrl ?? null,
    });
  }

  async requestDomainRefresh(params: { domain?: string; limit?: number }) {
    await this.dispatchAction({
      action: 'RUN_DOMAIN_HTTPS_REFRESH',
      domain: params.domain,
      limit: params.limit,
    });
    return { status: 'queued' };
  }
}
