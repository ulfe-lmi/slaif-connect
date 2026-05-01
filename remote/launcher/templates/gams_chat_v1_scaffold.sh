printf 'slaif_payload_result_begin\n'
printf '{"type":"slaif.gamsChatScaffoldResult.v1","sessionId":"%s","payloadId":"%s","status":"not_implemented","message":"GaMS chat worker broker and model serving are not implemented in this launcher foundation."}\n' \
  "${SLAIF_SESSION_ID:-}" \
  "${SLAIF_PAYLOAD_ID:-gams_chat_v1}"
printf 'slaif_payload_result_end\n'
