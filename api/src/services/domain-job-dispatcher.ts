import AWS from 'aws-sdk';

type DispatchOptions = {
  delayMs?: number;
};

export class DomainJobDispatcher {
  private readonly sqs: AWS.SQS;

  constructor(private readonly queueUrl: string, region?: string) {
    this.sqs = new AWS.SQS({ region });
  }

  async dispatch(jobId: string, options: DispatchOptions = {}): Promise<void> {
    if (!jobId) return;
    const delaySeconds = options.delayMs ? Math.min(900, Math.max(0, Math.round(options.delayMs / 1000))) : 0;
    await this.sqs
      .sendMessage({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({
          action: 'RUN_DOMAIN_JOB',
          jobId,
        }),
        DelaySeconds: delaySeconds,
      })
      .promise();
  }
}
