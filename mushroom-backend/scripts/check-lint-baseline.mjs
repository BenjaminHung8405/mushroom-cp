import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const baseline = JSON.parse(readFileSync('.lint-baseline.json', 'utf8'));
const report = readEslintReport();
const actual = normalizeReport(report);
const expected = baseline.legacyAllowlist;

if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error(
    'Legacy lint debt changed. Update .lint-baseline.json only with explicit review.',
  );
  process.exit(1);
}

console.log(
  `Verified ${baseline.totals.errors} legacy lint errors and ${baseline.totals.warnings} warnings against the reviewed baseline.`,
);

function readEslintReport() {
  try {
    execFileSync(
      'eslint',
      ['{src,apps,libs,test}/**/*.ts', '--format', 'json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return [];
  } catch (error) {
    if (!(error instanceof Error) || !('stdout' in error)) throw error;
    return JSON.parse(String(error.stdout));
  }
}

function normalizeReport(report) {
  const root = `${process.cwd()}/`;
  return report
    .filter(({ errorCount, warningCount }) => errorCount || warningCount)
    .map(({ filePath, errorCount, warningCount, messages }) => {
      const rules = {};
      for (const { ruleId } of messages) {
        const key = ruleId ?? 'fatal';
        rules[key] = (rules[key] ?? 0) + 1;
      }
      return {
        path: filePath.startsWith(root) ? filePath.slice(root.length) : filePath,
        errors: errorCount,
        warnings: warningCount,
        rules,
      };
    });
}
