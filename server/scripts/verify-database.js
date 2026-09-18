import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

async function verifyApplicationRole() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const [connection, role, migrations, tables, counts] = await Promise.all([
      pool.query(`select current_database() as database,
                         current_user as role,
                         current_setting('server_version_num') as server_version_num,
                         current_setting('timezone') as timezone`),
      pool.query(`select rolsuper, rolcreatedb, rolcreaterole, rolreplication,
                         rolcanlogin, rolconnlimit
                    from pg_roles where rolname = current_user`),
      pool.query('select name from schema_migrations order by name'),
      pool.query(`select count(*)::int as count
                    from pg_tables where schemaname = 'public'`),
      pool.query(`select
        (select count(*)::int from discord_message_events) as messages,
        (select count(*)::int from signal_interpretations) as signals,
        (select count(*)::int from discord_subscriptions where enabled) as enabled_subscriptions`)
    ]);
    return {
      ...connection.rows[0],
      privileges: role.rows[0],
      migrations: migrations.rows.map((row) => row.name),
      publicTables: tables.rows[0].count,
      rows: counts.rows[0]
    };
  } finally {
    await pool.end();
  }
}

async function verifyReadOnlyRole() {
  if (!process.env.DATABASE_READONLY_URL) return { configured: false };
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_READONLY_URL, max: 1 });
  try {
    const result = await pool.query(`select current_user as role,
                                            current_setting('default_transaction_read_only') as default_transaction_read_only,
                                            (select count(*)::int from schema_migrations) as migration_count`);
    return { configured: true, ...result.rows[0] };
  } finally {
    await pool.end();
  }
}

console.log(JSON.stringify({
  application: await verifyApplicationRole(),
  readOnly: await verifyReadOnlyRole()
}, null, 2));
