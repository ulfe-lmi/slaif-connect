export function buildHealthz({clock = () => new Date()} = {}) {
  const now = clock() instanceof Date ? clock() : new Date(clock());
  return {
    ok: true,
    status: 'alive',
    timestamp: now.toISOString(),
  };
}

async function runCheck(name, fn) {
  try {
    const result = await fn();
    const ok = result?.ok !== false;
    return {
      name,
      ok,
      ...result,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      errorCode: error.code || 'check_failed',
    };
  }
}

export async function evaluateReadiness({
  deploymentConfig,
  tokenStore,
  rateLimiter,
  relayAllowlist,
  auditLogger,
  auditSink,
  metricsRegistry,
  requireSignedPolicy = false,
  requireTrustRoots = false,
} = {}) {
  const checks = [];
  checks.push(await runCheck('deployment_config', () => ({
    ok: Boolean(deploymentConfig),
    env: deploymentConfig?.env,
  })));
  checks.push(await runCheck('token_store', () => {
    if (!tokenStore?.healthCheck) {
      return {ok: false, errorCode: 'token_store_missing'};
    }
    return tokenStore.healthCheck();
  }));
  checks.push(await runCheck('rate_limiter', () => {
    if (!rateLimiter?.healthCheck) {
      return {ok: false, errorCode: 'rate_limiter_missing'};
    }
    return rateLimiter.healthCheck();
  }));
  checks.push(await runCheck('relay_allowlist', () => {
    const count = relayAllowlist && typeof relayAllowlist === 'object' ?
      Object.keys(relayAllowlist).length :
      0;
    return {
      ok: count > 0,
      targetCount: count,
      errorCode: count > 0 ? undefined : 'relay_allowlist_empty',
    };
  }));
  checks.push(await runCheck('audit_logging', () => {
    const auditHealth = auditSink?.healthCheck ?
      auditSink.healthCheck() :
      auditLogger?.healthCheck?.();
    if (auditHealth) {
      return {
        mode: deploymentConfig?.auditLogMode || auditHealth.mode,
        ...auditHealth,
      };
    }
    return {
      ok: Boolean(auditLogger?.event || deploymentConfig?.auditLogMode),
      mode: deploymentConfig?.auditLogMode,
    };
  }));
  checks.push(await runCheck('metrics', () => {
    if (!metricsRegistry?.healthCheck) {
      return {ok: false, errorCode: 'metrics_registry_missing'};
    }
    return metricsRegistry.healthCheck();
  }));
  checks.push(await runCheck('signed_policy', () => ({
    ok: !requireSignedPolicy || Boolean(deploymentConfig?.signedPolicyFile),
    configured: Boolean(deploymentConfig?.signedPolicyFile),
    errorCode: requireSignedPolicy && !deploymentConfig?.signedPolicyFile ?
      'signed_policy_missing' :
      undefined,
  })));
  checks.push(await runCheck('policy_trust_roots', () => ({
    ok: !requireTrustRoots || Boolean(deploymentConfig?.policyTrustRootsFile),
    configured: Boolean(deploymentConfig?.policyTrustRootsFile),
    errorCode: requireTrustRoots && !deploymentConfig?.policyTrustRootsFile ?
      'policy_trust_roots_missing' :
      undefined,
  })));

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}
