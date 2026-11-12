import { spawn, execFileSync } from 'node:child_process';
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
config({ path: resolve(root, '.env'), quiet: true });

const env = { ...process.env };
env.POSTGRES_PASSWORD ||= 'change-this-local-password';
const encodedPassword = encodeURIComponent(env.POSTGRES_PASSWORD);
env.DATABASE_URL ||= `postgresql://bulls_media:${encodedPassword}@localhost:5432/bulls_media`;
env.MIGRATION_DATABASE_URL ||= env.DATABASE_URL;
env.DATABASE_SSL ||= 'false';
env.AUTH_BYPASS_DEV ||= 'true';
env.MOCK_LLM ||= 'true';

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', (error) => rejectRun(new Error(`Could not start ${command}: ${error.message}`)));
    child.once('close', (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${args.join(' ')} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

function databaseIsReady() {
  try {
    execFileSync('docker', [
      'compose', 'exec', '-T', 'db', 'pg_isready',
      '-U', 'bulls_media', '-d', 'bulls_media',
    ], { cwd: root, env, stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));

async function prepareDatabase() {
  process.stdout.write('\n[setup] Starting PostgreSQL in Docker...\n');
  await run('docker', ['compose', 'up', '-d', 'db']);

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (databaseIsReady()) return;
    await wait(1_000);
  }

  await run('docker', ['compose', 'logs', '--tail=80', 'db']).catch(() => undefined);
  throw new Error('PostgreSQL did not become ready within 45 seconds. Check that Docker Desktop is running.');
}

try {
  await prepareDatabase();
  process.stdout.write('\n[setup] Generating typed Prisma Client...\n');
  await run('npm', ['run', 'db:generate']);
  process.stdout.write('\n[setup] Applying Prisma migrations...\n');
  await run('npm', ['run', 'db:migrate']);
  process.stdout.write('\n[setup] Seeding demo orders...\n');
  await run('npm', ['run', 'db:seed']);
  process.stdout.write('\n[setup] Running tests before application startup...\n');
  await run('npm', ['test']);
  process.stdout.write('\n[setup] Checks passed. Starting API and frontend...\n');
  await run('npm', ['run', 'dev:services']);
} catch (error) {
  process.stderr.write(`\n${error instanceof Error ? error.message : 'Development startup failed.'}\n`);
  process.exitCode = 1;
}
