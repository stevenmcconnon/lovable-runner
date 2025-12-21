const DEFAULT_NAMESPACE = 'LovableRunner/Observability';

type MetricUnit = 'Milliseconds' | 'Count';

type MetricSpec = {
  value: number;
  unit?: MetricUnit;
};

type EmitParams = {
  namespace?: string;
  dimensions?: Record<string, string>;
  metrics: Record<string, MetricSpec>;
  properties?: Record<string, unknown>;
};

const toEmfPayload = ({ namespace, dimensions, metrics, properties }: EmitParams) => {
  const metricEntries = Object.entries(metrics).filter(([, spec]) =>
    Number.isFinite(spec?.value)
  );
  if (!metricEntries.length) {
    return null;
  }
  const dimensionKeys = Object.keys(dimensions || {});
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace || DEFAULT_NAMESPACE,
          Dimensions: dimensionKeys.length ? [dimensionKeys] : [],
          Metrics: metricEntries.map(([name, spec]) => ({
            Name: name,
            Unit: spec.unit || 'Count',
          })),
        },
      ],
    },
    ...(dimensions || {}),
    ...(properties || {}),
    ...metricEntries.reduce<Record<string, number>>((acc, [name, spec]) => {
      acc[name] = spec.value;
      return acc;
    }, {}),
  };
};

export const emitMetric = (params: EmitParams) => {
  const payload = toEmfPayload(params);
  if (!payload) return;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
};

export const recordApiRequestMetric = (params: {
  route?: string;
  method: string;
  statusCode: number;
  durationMs?: number;
  accountId?: string | null;
  slug?: string | null;
}) => {
  emitMetric({
    metrics: {
      RequestCount: { value: 1 },
      ...(Number.isFinite(params.durationMs)
        ? { DurationMs: { value: params.durationMs ?? 0, unit: 'Milliseconds' } }
        : {}),
    },
    dimensions: {
      Service: 'api',
      Route: (params.route || 'unknown').slice(0, 120),
      Method: params.method,
      StatusCode: String(params.statusCode),
    },
    properties: {
      accountId: params.accountId || null,
      slug: params.slug || null,
      success: params.statusCode < 500,
    },
  });
};

export const recordWorkerMetric = (params: {
  action: string;
  durationMs?: number;
  success: boolean;
  errorType?: string;
}) => {
  emitMetric({
    metrics: {
      JobCount: { value: 1 },
      ...(Number.isFinite(params.durationMs)
        ? { JobDurationMs: { value: params.durationMs ?? 0, unit: 'Milliseconds' } }
        : {}),
    },
    dimensions: {
      Service: 'worker',
      Action: params.action,
      Result: params.success ? 'success' : 'error',
    },
    properties: {
      errorType: params.errorType || null,
    },
  });
};

export const recordQueueDepthMetric = (params: {
  queueName: string;
  visible: number;
  notVisible?: number;
  delayed?: number;
}) => {
  emitMetric({
    metrics: {
      VisibleMessages: { value: params.visible },
      ...(Number.isFinite(params.notVisible)
        ? { InFlightMessages: { value: params.notVisible ?? 0 } }
        : {}),
      ...(Number.isFinite(params.delayed) ? { DelayedMessages: { value: params.delayed ?? 0 } } : {}),
    },
    dimensions: {
      Service: 'queue',
      QueueName: params.queueName,
    },
  });
};
