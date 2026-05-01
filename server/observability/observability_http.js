import {buildHealthz, evaluateReadiness} from '../health/health_checks.js';

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(value)}\n`);
}

export async function handleMetricsRequest(req, res, {metricsRegistry} = {}) {
  if (!metricsRegistry?.renderPrometheus) {
    sendJson(res, 503, {ok: false, error: 'metrics_unavailable'});
    return true;
  }
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(metricsRegistry.renderPrometheus());
  return true;
}

export async function handleHealthzRequest(_req, res, options = {}) {
  sendJson(res, 200, buildHealthz(options));
  return true;
}

export async function handleReadyzRequest(_req, res, options = {}) {
  const readiness = await evaluateReadiness(options);
  options.metricsRegistry?.setGauge?.('slaif_readiness_status', {}, readiness.ok ? 1 : 0);
  const tokenStoreCheck = readiness.checks?.find((check) => check.name === 'token_store');
  if (tokenStoreCheck) {
    options.metricsRegistry?.setGauge?.('slaif_token_store_health', {
      tokenStoreType: tokenStoreCheck.mode || 'unknown',
    }, tokenStoreCheck.ok ? 1 : 0);
  }
  const auditCheck = readiness.checks?.find((check) => check.name === 'audit_logging');
  if (auditCheck) {
    options.metricsRegistry?.setGauge?.('slaif_audit_sink_health', {
      mode: auditCheck.mode || 'unknown',
    }, auditCheck.ok ? 1 : 0);
  }
  sendJson(res, readiness.ok ? 200 : 503, readiness);
  return true;
}

export function createObservabilityHttpHandler({
  metricsPath = '/metrics',
  healthPath = '/healthz',
  readyPath = '/readyz',
  readinessOptions = {},
  metricsRegistry,
  clock,
} = {}) {
  return async function observabilityHttpHandler(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === metricsPath) {
      return handleMetricsRequest(req, res, {metricsRegistry});
    }
    if (url.pathname === healthPath) {
      return handleHealthzRequest(req, res, {clock});
    }
    if (url.pathname === readyPath) {
      return handleReadyzRequest(req, res, {
        ...readinessOptions,
        metricsRegistry,
      });
    }
    return false;
  };
}
