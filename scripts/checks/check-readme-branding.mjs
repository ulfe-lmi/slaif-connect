import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

const expected = [
  '<div style="text-align: center;">',
  '  <a href="https://www.slaif.si">',
  '    <img src="https://slaif.si/img/logos/SLAIF_logo_ANG_barve.svg" width="400" height="400">',
  '  </a>',
  '</div>',
].join('\n');

if (!readme.startsWith(expected)) {
  console.error('README.md must start with the SLAIF linked logo block.');
  process.exit(1);
}

console.log('README branding check OK');
