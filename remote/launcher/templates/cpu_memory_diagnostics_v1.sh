printf 'slaif_payload_result_begin\n'
printf '{"type":"slaif.cpuMemoryDiagnosticsResult.v1","sessionId":"%s","payloadId":"%s","status":"ok","hostname":"%s","timestamp":"%s"' \
  "${SLAIF_SESSION_ID:-}" \
  "${SLAIF_PAYLOAD_ID:-cpu_memory_diagnostics_v1}" \
  "$(hostname 2>/dev/null || printf unknown)" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf unknown)"
if command -v nproc >/dev/null 2>&1; then
  printf ',"cpuCount":%s' "$(nproc)"
fi
if command -v uname >/dev/null 2>&1; then
  printf ',"architecture":"%s"' "$(uname -m | tr -cd 'A-Za-z0-9_.-')"
fi
if command -v free >/dev/null 2>&1; then
  mem_kb="$(free -k | awk '/^Mem:/ {print $2; exit}')"
  case "$mem_kb" in
    ''|*[!0-9]*) ;;
    *) printf ',"memoryKiB":%s' "$mem_kb" ;;
  esac
fi
printf '}\n'
printf 'slaif_payload_result_end\n'
