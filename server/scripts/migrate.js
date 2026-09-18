import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, '../../db/migrations');
const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  for (const file of files) {
    const exists = await pool.query('select 1 from schema_migrations where name=$1', [file]);
    if (exists.rowCount) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }
} finally { await pool.end(); }
