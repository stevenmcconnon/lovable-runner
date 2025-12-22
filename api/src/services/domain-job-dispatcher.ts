import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

type DispatchOptions = {
  delayMs?: number;
};

type DispatcherConfig =
  | string
  | {
      queueUrl?: string;
      topicArn?: string;
      region?: string;
    };

export class DomainJobDispatcher {
  private readonly sqs?: SQSClient;

  private readonly sns?: SNSClient;

  private readonly queueUrl?: string;

  private readonly topicArn?: string;

  constructor(target: DispatcherConfig, fallbackRegion?: string) {
    if (typeof target === 'string') {
      this.queueUrl = target;
      this.sqs = new SQSClient({ region: fallbackRegion });
      return;
    }
    this.queueUrl = target.queueUrl;
    this.topicArn = target.topicArn;
    const region = target.region || fallbackRegion;
    if (this.queueUrl) {
      this.sqs = new SQSClient({ region });
    }
    if (this.topicArn) {
      this.sns = new SNSClient({ region });
    }
  }

  async dispatch(jobId: string, options: DispatchOptions = {}): Promise<void> {
    if (!jobId) return;
    const payload = JSON.stringify({
      action: 'RUN_DOMAIN_JOB',
      jobId,
    });
    const delaySeconds = options.delayMs ? Math.min(900, Math.max(0, Math.round(options.delayMs / 1000))) : 0;

    if (delaySeconds > 0) {
      if (!this.sqs || !this.queueUrl) {
        throw new Error('Delayed domain job dispatch requires an SQS queue.');
      }
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: payload,
          DelaySeconds: delaySeconds,
        })
      );
      return;
    }

    if (this.sns && this.topicArn) {
      await this.sns.send(
        new PublishCommand({
          TopicArn: this.topicArn,
          Message: payload,
        })
      );
      return;
    }

    if (this.sqs && this.queueUrl) {
      await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: payload,
        })
      );
    }
  }
}
