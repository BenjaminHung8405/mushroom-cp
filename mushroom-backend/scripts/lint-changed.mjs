import { execFileSync } from 'node:child_process';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function resolveBaseRef() {
  const baseRef = process.env.LINT_BASE_REF;
  if (!baseRef) {
    const originMain = git(['rev-parse', '--verify', 'origin/main^{commit}']).trim();
    const head = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
    if (originMain === head) {
      throw new Error(
        'LINT_BASE_REF is required when HEAD equals origin/main; refusing an empty reviewed range.',
      );
    }
    return originMain;
  }

  const baseSha = git(['rev-parse', '--verify', `${baseRef}^{commit}`]).trim();
  const headSha = git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
  if (baseSha === headSha) {
    throw new Error('LINT_BASE_REF must not resolve to HEAD.');
  }
  git(['merge-base', '--is-ancestor', baseSha, headSha]);
  return baseSha;
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
