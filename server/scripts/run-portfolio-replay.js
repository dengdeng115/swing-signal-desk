import 'dotenv/config';
import pg from 'pg';
import { LongbridgeQuoteService } from '../src/services/longbridge-quotes.js';
import { runPortfolioReplay } from '../src/services/portfolio-replay-runner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await runPortfolioReplay({ pool, quoteService: new LongbridgeQuoteService({ ttlMs: 0 }) });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}
