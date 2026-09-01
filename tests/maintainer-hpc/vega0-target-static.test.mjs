import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateMaintainerConfig} from '../../maintainer/hpc-test-kit/local/validate-maintainer-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const targetDir = path.join(root, 'maintainer/test-targets/vega0');

const requiredFiles = [
  'README.md',
  'GOAL_AND_SCOPE.md',
  'ARCHITECTURE.md',
  'SOFTWARE.md',
  'PREPARATION.md',
  'IDENTITY_AND_CREDENTIALS.md',
  'DEPLOYMENT_MAP.md',
  'BUILD_CHECKLIST.md',
  'SLAIF_CONNECT_INTEGRATION.md',
  'ACCEPTANCE.md',
  'OPERATIONS_AND_RECOVERY.md',
  'SOURCES.md',
  'config/slurm/slurm.conf',
  'config/slurm/cgroup.conf',
  'config/slurm/slurmdbd.conf.example',
  'config/nfs/exports',
  'config/ssh/60-ssh-user-vega.conf',
  'config/systemd/container-fido-ipa.service',
  'node-scripts/vega-thermal-guard',
  'acceptance/run-user-command.exp',
  'acceptance/run-user-test',
  'acceptance/hpc-test-kit.vega0-lab.example.json',
];

for (const relativePath of requiredFiles) {
  assert.equal(
      fs.existsSync(path.join(targetDir, relativePath)),
      true,
      `missing Vega0 target artifact: ${relativePath}`,
  );
}

const slurm = fs.readFileSync(path.join(targetDir, 'config/slurm/slurm.conf'), 'utf8');
assert.match(slurm, /ClusterName=vega0/);
assert.match(slurm, /AccountingStorageEnforce=associations,limits,qos,safe/);
assert.match(slurm, /PartitionName=cpu Nodes=vega0-worker/);
assert.match(slurm, /PartitionName=dev Nodes=vega0-login/);
assert.match(slurm, /PartitionName=all Nodes=vega0-login,vega0-worker/);
assert.match(slurm, /TaskPlugin=task\/cgroup,task\/affinity/);

const slurmdbd = fs.readFileSync(
    path.join(targetDir, 'config/slurm/slurmdbd.conf.example'),
    'utf8',
);
assert.match(slurmdbd, /StoragePass=REPLACE_LOCALLY/);

const nfsExport = fs.readFileSync(path.join(targetDir, 'config/nfs/exports'), 'utf8');
assert.match(nfsExport, /sec=sys/);
assert.equal(nfsExport.includes('krb5p'), false, 'operational NFS export must not advertise krb5p');
assert.match(nfsExport, /root_squash/);

const sshConfig = fs.readFileSync(
    path.join(targetDir, 'config/ssh/60-ssh-user-vega.conf'),
    'utf8',
);
assert.match(sshConfig, /AuthenticationMethods publickey,keyboard-interactive:pam/);
assert.match(sshConfig, /AuthorizedKeysCommand \/usr\/bin\/sss_ssh_authorizedkeys/);
assert.match(sshConfig, /AllowTcpForwarding no/);

const identityRecipe = fs.readFileSync(
    path.join(targetDir, 'IDENTITY_AND_CREDENTIALS.md'),
    'utf8',
);
assert.match(identityRecipe, /--user-auth-type=otp/);
assert.match(identityRecipe, /ipa otptoken-add user-test/);
assert.match(identityRecipe, /ipa hbacrule-add-service hpc-users-login --hbacsvcs=sshd/);
assert.match(identityRecipe, /ipa hbacrule-disable allow_all/);
assert.match(identityRecipe, /worker: Access granted: False/);
assert.match(identityRecipe, /Never copy the private key/);

const buildChecklist = fs.readFileSync(
    path.join(targetDir, 'BUILD_CHECKLIST.md'),
    'utf8',
);
assert.match(buildChecklist, /pre-existing administrative account remains unchanged and usable/);
assert.match(buildChecklist, /Existing worker NFS mount recovers after login reboot/);
assert.match(buildChecklist, /No password, OTP seed\/value, private key, ticket, or token is committed/);

const thermalGuard = fs.readFileSync(
    path.join(targetDir, 'node-scripts/vega-thermal-guard'),
    'utf8',
);
assert.match(thermalGuard, /thermal_max_mC=75000/);

const ipaService = fs.readFileSync(
    path.join(targetDir, 'config/systemd/container-fido-ipa.service'),
    'utf8',
);
assert.match(ipaService, /CPUQuota=150%/);
assert.equal(ipaService.includes('overlay-containers/'), false, 'unit must not embed a container ID');

const acceptanceRunner = fs.readFileSync(
    path.join(targetDir, 'acceptance/run-user-command.exp'),
    'utf8',
);
assert.match(acceptanceRunner, /StrictHostKeyChecking=yes/);
assert.match(acceptanceRunner, /UserKnownHostsFile=/);
assert.match(acceptanceRunner, /HostKeyAlias=/);
assert.equal(acceptanceRunner.includes('StrictHostKeyChecking=no'), false);

function walkFiles(directory) {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(fullPath) : [fullPath];
  });
}

const allText = walkFiles(targetDir)
    .map((filePath) => fs.readFileSync(filePath, 'utf8'))
    .join('\n');
assert.equal(allText.includes('BEGIN OPENSSH PRIVATE KEY'), false);
assert.equal(allText.includes('BEGIN PRIVATE KEY'), false);
assert.equal(allText.includes('Vega0DB-2026'), false);
assert.equal(allText.includes('Vega0User-2026'), false);
assert.equal(allText.includes('JBSWY3DPEHPK3PXP'), false);

const exampleConfig = JSON.parse(fs.readFileSync(
    path.join(targetDir, 'acceptance/hpc-test-kit.vega0-lab.example.json'),
    'utf8',
));
validateMaintainerConfig(exampleConfig, {exampleMode: true});

console.log('Vega0 test-target static safety tests OK');
