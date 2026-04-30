import process from 'node:process';
import {
  startRealHpcPilotStack,
  stopRealHpcPilotStack,
} from '../../tools/start-real-hpc-pilot-stack.mjs';

if (process.env.SLAIF_RUN_REAL_HPC_PILOT !== '1') {
  console.log('real-HPC pilot smoke test skipped; set SLAIF_RUN_REAL_HPC_PILOT=1 with verified pilot policy inputs to run it');
  process.exit(0);
}

for (const name of [
  'SLAIF_PILOT_SIGNED_POLICY',
  'SLAIF_PILOT_TRUST_ROOTS',
  'SLAIF_PILOT_ALIAS',
]) {
  if (!process.env[name]) {
    throw new Error(`${name} is required when SLAIF_RUN_REAL_HPC_PILOT=1`);
  }
}

const stack = await startRealHpcPilotStack({
  allowRealHpc: true,
  signedPolicy: process.env.SLAIF_PILOT_SIGNED_POLICY,
  trustRoots: process.env.SLAIF_PILOT_TRUST_ROOTS,
  alias: process.env.SLAIF_PILOT_ALIAS,
  usernameHint: process.env.SLAIF_PILOT_USERNAME_HINT,
  expectedOutput: process.env.SLAIF_PILOT_EXPECTED_OUTPUT || 'slaif-pilot-ok',
  quiet: true,
});

console.log(`real-HPC pilot stack started for ${stack.hpc}`);
console.log(`launcher: ${stack.launcherUrl}?extensionId=<extension-id>`);
console.log('manual authentication is required in the browser extension; this scaffold does not automate passwords or OTPs');
await stopRealHpcPilotStack(stack);
