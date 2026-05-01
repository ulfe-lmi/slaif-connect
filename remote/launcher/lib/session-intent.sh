#!/bin/sh
set -eu

# Shell helper placeholder for site launcher integrations. The reference
# implementation validates JSON intent files in lib/launcher-intent.py.
slaif_session_intent_contract() {
  printf '%s\n' 'session intent resolves sessionId to payloadId; it must not contain commands or scripts'
}
