const METRIC_NAME_PATTERN = /^slaif_[a-z0-9_]+$/;
const LABEL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_LABEL_NAMES = new Set([
  'token',
  'launchToken',
  'relayToken',
  'jobReportToken',
  'tokenFingerprint',
  'sessionId',
  'username',
  'password',
  'otp',
  'privateKey',
  'passphrase',
  'transcript',
  'stdout',
  'stderr',
  'payload',
  'command',
]);
const FORBIDDEN_LABEL_VALUE_PATTERN =
  /slaif_tok_|launchToken|relayToken|jobReportToken|password|otp|private.?key|BEGIN [A-Z ]*PRIVATE KEY|Submitted batch job|SSH_/i;
const DEFAULT_METRICS = Object.freeze({
  counters: [
    'slaif_descriptor_requests_total',
    'slaif_descriptor_rejections_total',
    'slaif_tokens_issued_total',
    'slaif_tokens_consumed_total',
    'slaif_tokens_rejected_total',
    'slaif_relay_auth_total',
    'slaif_relay_connections_total',
    'slaif_relay_timeouts_total',
    'slaif_relay_bytes_total',
    'slaif_job_reports_total',
    'slaif_job_report_rejections_total',
    'slaif_rate_limit_rejections_total',
  ],
  gauges: [
    'slaif_relay_active_connections',
    'slaif_readiness_status',
    'slaif_token_store_health',
    'slaif_audit_sink_health',
  ],
  histograms: [
    'slaif_relay_connection_duration_seconds',
    'slaif_descriptor_duration_seconds',
    'slaif_job_report_duration_seconds',
  ],
});

export class MetricsError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'MetricsError';
    this.code = code;
  }
}

function assertMetricName(name) {
  if (typeof name !== 'string' || !METRIC_NAME_PATTERN.test(name)) {
    throw new MetricsError('invalid_metric_name', 'invalid metric name');
  }
}

function sanitizeLabels(labels = {}, {environment} = {}) {
  const sanitized = {};
  for (const [name, value] of Object.entries(labels || {})) {
    if (!LABEL_NAME_PATTERN.test(name) ||
        [...FORBIDDEN_LABEL_NAMES].some((forbidden) => forbidden.toLowerCase() === name.toLowerCase())) {
      throw new MetricsError('forbidden_metric_label', `forbidden metric label ${name}`);
    }
    const text = String(value);
    if (text.length > 128 || FORBIDDEN_LABEL_VALUE_PATTERN.test(text)) {
      throw new MetricsError('forbidden_metric_label_value',
          `forbidden metric label value for ${name}`);
    }
    sanitized[name] = text;
  }
  if (environment && !('environment' in sanitized)) {
    sanitized.environment = environment;
  }
  return sanitized;
}

function labelsKey(labels) {
  return JSON.stringify(Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)));
}

function formatLabels(labels) {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }
  const body = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
      .join(',');
  return `{${body}}`;
}

function storeSample(map, name, labels, update) {
  assertMetricName(name);
  const key = `${name}:${labelsKey(labels)}`;
  const existing = map.get(key) || {name, labels, value: 0};
  update(existing);
  map.set(key, existing);
  return existing;
}

export function createMetricsRegistry({environment = 'development'} = {}) {
  const counters = new Map();
  const gauges = new Map();
  const histograms = new Map();

  return {
    increment(name, labels = {}, value = 1) {
      const safeLabels = sanitizeLabels(labels, {environment});
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new MetricsError('invalid_metric_value', 'invalid metric value');
      }
      return storeSample(counters, name, safeLabels, (sample) => {
        sample.value += amount;
      });
    },
    setGauge(name, labels = {}, value) {
      const safeLabels = sanitizeLabels(labels, {environment});
      const amount = Number(value);
      if (!Number.isFinite(amount)) {
        throw new MetricsError('invalid_metric_value', 'invalid metric value');
      }
      return storeSample(gauges, name, safeLabels, (sample) => {
        sample.value = amount;
      });
    },
    observeHistogram(name, labels = {}, value) {
      const safeLabels = sanitizeLabels(labels, {environment});
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new MetricsError('invalid_metric_value', 'invalid metric value');
      }
      return storeSample(histograms, name, safeLabels, (sample) => {
        sample.count = (sample.count || 0) + 1;
        sample.sum = (sample.sum || 0) + amount;
        sample.value = sample.sum;
      });
    },
    renderPrometheus() {
      const lines = [];
      for (const name of DEFAULT_METRICS.counters) {
        lines.push(`# TYPE ${name} counter`);
      }
      for (const name of DEFAULT_METRICS.gauges) {
        lines.push(`# TYPE ${name} gauge`);
      }
      for (const name of DEFAULT_METRICS.histograms) {
        lines.push(`# TYPE ${name} summary`);
      }
      for (const sample of counters.values()) {
        lines.push(`${sample.name}${formatLabels(sample.labels)} ${sample.value}`);
      }
      for (const sample of gauges.values()) {
        lines.push(`${sample.name}${formatLabels(sample.labels)} ${sample.value}`);
      }
      for (const sample of histograms.values()) {
        lines.push(`${sample.name}_count${formatLabels(sample.labels)} ${sample.count || 0}`);
        lines.push(`${sample.name}_sum${formatLabels(sample.labels)} ${sample.sum || 0}`);
      }
      return `${lines.join('\n')}\n`;
    },
    healthCheck() {
      return {ok: true, mode: 'prometheus'};
    },
    reset() {
      counters.clear();
      gauges.clear();
      histograms.clear();
    },
    _samples() {
      return {
        counters: [...counters.values()],
        gauges: [...gauges.values()],
        histograms: [...histograms.values()],
      };
    },
  };
}
