import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const envExample = readFileSync(resolve(root, '.env.example'), 'utf8');
const compose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
const variables = parseEnvironment(envExample);

const expected = {
  JWT_SECRET: 'CHANGE_ME_generate_a_separate_jwt_secret',
  TUNING_SSE_TICKET_SECRET:
    'CHANGE_ME_generate_a_separate_32_byte_minimum_secret',
};

for (const [name, value] of Object.entries(expected)) {
  if (variables[name] !== value) {
    fail(`.env.example must define ${name} with its required placeholder.`);
  }
}

if (variables.JWT_SECRET === variables.TUNING_SSE_TICKET_SECRET) {
  fail('.env.example must use separate JWT and SSE-ticket placeholders.');
}

if (Buffer.byteLength(variables.TUNING_SSE_TICKET_SECRET, 'utf8') < 32) {
  fail('TUNING_SSE_TICKET_SECRET placeholder must be at least 32 UTF-8 bytes.');
}

const backend = compose.match(/  mushroom-backend:\n([\s\S]*?)(?=\n  [^\s]|\nnetworks:|$)/)?.[1];
if (!backend) fail('docker-compose.yml must define mushroom-backend.');

for (const name of Object.keys(expected)) {
  const requiredMapping = new RegExp(
    `- ${name}=\\$\\{${name}:\\?${name} is required\\}`,
  );
  if (!requiredMapping.test(backend)) {
    fail(`mushroom-backend must require and receive ${name}.`);
  }
}

console.log(
  'Backend authentication configuration smoke check passed: Compose requires and receives both independent secrets from .env.',
);

function parseEnvironment(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
      .filter(([name]) => name),
  );
}

function fail(message) {
  console.error(`Backend authentication configuration smoke check failed: ${message}`);
  process.exit(1);
}
