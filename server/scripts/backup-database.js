import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../..');
const backupDir = path.resolve(projectRoot, process.env.DB_BACKUP_DIR || 'server/data/backups');
const connection = new URL(process.env.DATABASE_URL);
const database = connection.pathname.replace(/^\//, '');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const baseName = `${database}-${timestamp}`;
const dumpPath = path.join(backupDir, `${baseName}.dump`);
const manifestPath = path.join(backupDir, `${baseName}.json`);

const defaultBin = process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\13\\bin' : '';
const pgDump = process.env.PG_DUMP_PATH || (defaultBin && existsSync(path.join(defaultBin, 'pg_dump.exe'))
  ? path.join(defaultBin, 'pg_dump.exe')
  : 'pg_dump');
const pgRestore = process.env.PG_RESTORE_PATH || (defaultBin && existsSync(path.join(defaultBin, 'pg_restore.exe'))
  ? path.join(defaultBin, 'pg_restore.exe')
  : 'pg_restore');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} failed with exit code ${code}: ${stderr.trim()}`)));
  });
}

await fs.mkdir(backupDir, { recursive: true });
const childEnv = { ...process.env, PGPASSWORD: decodeURIComponent(connection.password) };
await run(pgDump, [
  '--host', connection.hostname,
  '--port', connection.port || '5432',
  '--username', decodeURIComponent(connection.username),
  '--dbname', database,
  '--format', 'custom',
  '--compress', '9',
  '--no-owner',
  '--no-privileges',
  '--file', dumpPath
], { env: childEnv });

await run(pgRestore, ['--list', dumpPath], { env: childEnv });
const data = await fs.readFile(dumpPath);
const manifest = {
  createdAt: new Date().toISOString(),
  database,
  host: connection.hostname,
  port: Number(connection.port || 5432),
  format: 'pg_dump custom',
  bytes: data.byteLength,
  sha256: createHash('sha256').update(data).digest('hex'),
  archiveListVerified: true,
  dumpFile: path.basename(dumpPath)
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ backupDirectory: backupDir, manifest }, null, 2));
