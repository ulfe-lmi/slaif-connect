# Host-Key and Host-CA Rotation

SLAIF Connect must verify the HPC SSH host key or host CA before user authentication. Rotation is therefore a signed policy operation, not a session descriptor operation.

## Preferred Model

Where possible, an HPC center should use SSH host certificates. SLAIF Connect then pins the HPC host CA in the signed HPC policy. This supports normal login-node changes without publishing every individual host key.

## Pinned Host-Key Model

For sites without SSH host certificates:

1. Publish a signed policy with the current host key.
2. Before rotation, publish a higher-sequence signed policy containing both old and new keys.
3. Wait through the announced overlap window.
4. Publish another higher-sequence signed policy that removes the old key.

The extension must reject unknown and changed host keys outside the signed policy.

## Operational Rules

- Private policy signing keys must never be committed.
- Host-key updates must be signed by a trusted policy key.
- Session descriptors must not carry host keys or `known_hosts`.
- Rollback to a lower signed policy sequence is rejected.
- Same policy sequence with different signed content is rejected.
- Emergency revocation should publish a higher-sequence policy that removes the compromised key and shortens validity windows as needed.

## Current Status

This repository now contains the verification, validation, signing-tooling, and rollback foundation. Production still needs real SLAIF signing-key operations, real HPC host keys or host CAs, and an approved rotation procedure.
