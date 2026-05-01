printf 'slaif_payload_result_begin\n'
printf '{"type":"slaif.gpuDiagnosticsResult.v1","sessionId":"%s","payloadId":"%s","status":"ok","hostname":"%s","timestamp":"%s","cudaVisibleDevices":"%s"' \
  "${SLAIF_SESSION_ID:-}" \
  "${SLAIF_PAYLOAD_ID:-gpu_diagnostics_v1}" \
  "$(hostname 2>/dev/null || printf unknown)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf unknown)" \
  "${CUDA_VISIBLE_DEVICES:-}"
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_count="$(nvidia-smi -L 2>/dev/null | awk 'END {print NR}')"
  case "$gpu_count" in
    ''|*[!0-9]*) gpu_count=0 ;;
  esac
  printf ',"nvidiaSmiAvailable":true,"gpuCount":%s' "$gpu_count"
else
  printf ',"nvidiaSmiAvailable":false,"gpuCount":0'
fi
printf '}\n'
printf 'slaif_payload_result_end\n'
