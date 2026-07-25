import { execFileSync } from 'node:child_process';

const baseRef = process.env.LINT_BASE_REF;
const diffArgs = baseRef
  ? ['diff', '--diff-filter=ACMR', '--name-only', `${baseRef}...HEAD`, '--', '*.ts']
  : ['diff', '--diff-filter=ACMR', '--name-only', 'HEAD', '--', '*.ts'];

const changedFiles = [
  ...execFileSync('git', diffArgs, { encoding: 'utf8' }).split('\n'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', '*.ts'], {
    encoding: 'utf8',
  }).split('\n'),
];

const files = changedFiles
  .map((file) => file.trim())
  .filter((file) => file.startsWith('mushroom-backend/') && file.endsWith('.ts'))
  .map((file) => file.slice('mushroom-backend/'.length));

if (files.length === 0) {
  console.log('No changed TypeScript files to lint.');
  process.exit(0);
}

execFileSync('eslint', files, { stdio: 'inherit' });
