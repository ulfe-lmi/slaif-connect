# SLAIF Connect Threat Model

This table tracks the practical threats for the relay-only starter. Acceptance
criteria are written as checks future PRs must satisfy before production use.

| Threat | Mitigation | Acceptance criteria |
|---|---|---|
| Relay reroutes to fake SSH server | Extension pins the expected HPC host key or host CA and verifies it before any user authentication prompt. | A fake SSH server behind the relay causes a host-key failure, no password/OTP/private-key prompt is shown, and the session stops. |
| Relay becomes open TCP proxy | Relay token maps server-side to an approved session and HPC alias; relay ignores or rejects client host/port fields. | Requests containing arbitrary `host` or `port` never influence `net.connect`; unknown aliases are rejected. |
| Compromised SLAIF web app requests malicious command | Extension policy owns command templates; web input provides only validated identifiers. | The extension rejects arbitrary command strings and builds only `/opt/slaif/bin/slaif-launch --session ${SESSION_ID}` style commands. |
| Compromised relay logs SSH payloads | Relay logs only session metadata, byte counts, lifecycle events, and errors. | Code review and log tests show no binary payload, terminal text, password prompt, OTP, or private-key material is logged. |
| Relay token theft | Tokens are short-lived, single-use or session-bound, and not placed in URLs. | Missing, malformed, expired, reused, or wrong-session tokens are rejected before TCP connection. |
| Unknown or changed SSH host key | Production policy requires pinned host keys or a pinned host CA; no automatic acceptance. | Unknown and changed keys fail closed; there is no `StrictHostKeyChecking=no` equivalent in production. |
| Malicious web origin launches extension | Manifest `externally_connectable` is narrow and background code validates `sender.url`. | Messages from unlisted origins receive `{ok:false,error:"origin_not_allowed"}` and no session page opens. |
| Session ID command injection | Session IDs use a strict safe regex before command construction. | Values containing spaces, quotes, semicolons, shell metacharacters, slashes, control characters, or non-ASCII are rejected. |
| Compromised extension build or remote code loading | Extension bundles executable JS/WASM and vendors upstream at build time from pinned source. | Manifest/CSP and build review show no executable remote JS/WASM imports from GitHub, Gitiles, CDN, or SLAIF servers. |
| Relay availability failure | UI surfaces failures clearly; relay closes WSS/TCP cleanly; future retries are explicit. | Dropped, throttled, or reset relay connections terminate the SSH session with a visible error and no credential leakage. |

Residual risk: the relay always sees metadata such as timing, traffic volume,
selected approved alias, and connection success or failure. Treat relay logs as
sensitive operational data.
