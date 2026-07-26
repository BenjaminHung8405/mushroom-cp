import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function resolveBaseRef() {
  if (process.env.LINT_BASE_REF) return process.env.LINT_BASE_REF;

  try {
    return git(['merge-base', 'origin/main', 'HEAD']).trim();
  } catch {
    return 'HEAD^';
  }
}

const baseRef = resolveBaseRef();
const diffArgs = [
  'diff',
  '--diff-filter=ACMR',
  '--name-only',
  `${baseRef}...HEAD`,
  '--',
  '*.ts',
];

const changedFiles = [
  ...git(diffArgs).split('\n'),
  ...git(['diff', '--diff-filter=ACMR', '--name-only', '--', '*.ts']).split(
    '\n',
  ),
  ...git([
    'diff',
    '--cached',
    '--diff-filter=ACMR',
    '--name-only',
    '--',
    '*.ts',
  ]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard', '--', '*.ts']).split(
    '\n',
  ),
];

const files = [
  ...new Set(
    changedFiles
      .map((file) => file.trim())
      .filter(
        (file) => file.startsWith('mushroom-backend/') && file.endsWith('.ts'),
      )
      .map((file) => file.slice('mushroom-backend/'.length)),
  ),
].sort();

if (files.length === 0) {
  console.log(`No changed TypeScript files to lint since ${baseRef}.`);
  process.exit(0);
}

execFileSync('eslint', files, { stdio: 'inherit' });
