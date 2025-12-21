import AWS from 'aws-sdk';
import { DatabaseService } from './database';
import { config } from '../env';
import { recordQueueDepthMetric } from './metrics';
import { StatusCount } from '../types';

export type QueueStat = {
  name: string;
  visible: number;
  inFlight: number;
  delayed: number;
};

export type TelemetrySnapshot = {
  collectedAt: string;
  domainJobs: StatusCount[];
  notificationJobs: StatusCount[];
  launches: StatusCount[];
  queues: QueueStat[];
  recentJobErrors24h: number;
};

export class TelemetryService {
  private readonly sqs: AWS.SQS | null;

  constructor(private readonly deps: { db: DatabaseService }) {
    this.sqs = config.awsRegion ? new AWS.SQS({ region: config.awsRegion }) : null;
  }

  private async fetchQueueStat(queueUrl?: string | null, label?: string): Promise<QueueStat | null> {
    if (!queueUrl || !this.sqs) return null;
    try {
      const { Attributes } = await this.sqs
        .getQueueAttributes({
          QueueUrl: queueUrl,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed',
          ],
        })
        .promise();
      const visible = Number(Attributes?.ApproximateNumberOfMessages ?? 0);
      const inFlight = Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0);
      const delayed = Number(Attributes?.ApproximateNumberOfMessagesDelayed ?? 0);
      recordQueueDepthMetric({
        queueName: label || queueUrl,
        visible,
        notVisible: inFlight,
        delayed,
      });
      return {
        name: label || queueUrl,
        visible,
        inFlight,
        delayed,
      };
    } catch (error) {
      console.warn('[telemetry] Failed to read queue attributes', {
        queueUrl,
        err: (error as Error)?.message,
      });
      return null;
    }
  }

  async getSnapshot(): Promise<TelemetrySnapshot> {
    const [domainJobs, notificationJobs, launches, jobErrors] = await Promise.all([
      this.deps.db.summarizeDomainJobs(),
      this.deps.db.summarizeNotificationJobs(),
      this.deps.db.summarizeLaunches(24),
      this.deps.db.countRecentJobErrors(24),
    ]);
    const queueTargets = [
      { url: config.runner.queueUrl, name: 'RunnerJobs' },
      { url: config.queues.domainJobs, name: 'DomainJobQueue' },
      { url: config.queues.notifications, name: 'NotificationJobQueue' },
      { url: config.analyticsQueueUrl, name: 'AnalyticsEvents' },
    ];
    const queueStatsRaw = await Promise.all(
      queueTargets.map((target) => this.fetchQueueStat(target.url, target.name))
    );
    const queueStats = queueStatsRaw.filter((entry): entry is QueueStat => Boolean(entry));
    return {
      collectedAt: new Date().toISOString(),
      domainJobs,
      notificationJobs,
      launches,
      queues: queueStats,
      recentJobErrors24h: jobErrors,
    };
  }
}
