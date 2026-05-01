import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';

function parseArgs(argv) {
  const args = {port: '22'};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host') {
      args.host = argv[++i];
    } else if (arg === '--port') {
      args.port = argv[++i];
    } else if (arg === '--alias') {
      args.alias = argv[++i];
    } else if (arg === '--out') {
      args.out = argv[++i];
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return args;
}

function requireSafeValue(value, label, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`invalid ${label}`);
  }
}

function rewriteHostField(line, alias, port) {
  if (!alias) {
    return line;
  }
  const fields = line.trim().split(/\s+/);
  if (fields.length < 3) {
    return line;
  }
  fields[0] = port === '22' ? alias : `[${alias}]:${port}`;
  return fields.join(' ');
}

function printFingerprints(knownHostsPath) {
  const result = spawnSync('ssh-keygen', ['-lf', knownHostsPath], {encoding: 'utf8'});
  if (result.status === 0) {
    process.stdout.write(result.stdout);
    return;
  }
  console.warn('ssh-keygen could not print fingerprints; inspect candidate file manually');
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

try {
  const args = parseArgs(process.argv);
  requireSafeValue(args.host, 'host', /^[A-Za-z0-9.-]+$/);
  requireSafeValue(args.port, 'port', /^[0-9]{1,5}$/);
  if (args.alias) {
    requireSafeValue(args.alias, 'alias', /^[A-Za-z0-9_.-]+$/);
  }
  if (!args.out) {
    throw new Error('--out is required');
  }

  const scan = spawnSync('ssh-keyscan', ['-p', args.port, args.host], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (scan.status !== 0 || !scan.stdout.trim()) {
    if (scan.stderr) {
      process.stderr.write(scan.stderr);
    }
    throw new Error('ssh-keyscan failed or returned no host keys');
  }

  const lines = scan.stdout
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.startsWith('#'))
      .map((line) => rewriteHostField(line, args.alias, args.port));
  if (lines.length === 0) {
    throw new Error('ssh-keyscan returned no usable known_hosts lines');
  }

  const outPath = path.resolve(args.out.replace(/^~(?=$|\/)/, os.homedir()));
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, {mode: 0o600});

  console.log('UNVERIFIED CANDIDATE HOST KEYS');
  console.log(`Wrote candidate known_hosts lines to ${outPath}`);
  console.log('Verify these fingerprints out of band before using them in signed policy or real tests.');
  printFingerprints(outPath);
} catch (error) {
  console.error(`host-key candidate collection failed: ${error.message}`);
  process.exit(1);
}
