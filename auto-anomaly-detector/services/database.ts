import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

let DATABASE_URL = process.env.DATABASE_URL || '';

// Check if it's Render.com database
const isRenderDatabase = DATABASE_URL.includes('render.com');

// For Render.com, ensure SSL mode is set in connection string if not already present
if (isRenderDatabase && !DATABASE_URL.includes('sslmode=')) {
  DATABASE_URL += (DATABASE_URL.includes('?') ? '&' : '?') + 'sslmode=require';
}

// Determine if we're connecting to local database
const isLocalDatabase = DATABASE_URL.includes('localhost') || 
                        DATABASE_URL.includes('127.0.0.1') ||
                        (DATABASE_URL.includes('postgres') && !isRenderDatabase && !DATABASE_URL.includes('amazonaws.com'));

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: isLocalDatabase ? false : {
    rejectUnauthorized: false,
  },
});

// Test database connection
export async function testConnection(): Promise<boolean> {
  let client: PoolClient | null = null;
  try {
    console.log('🔌 Testing PostgreSQL connection...');
    const maskedUrl = DATABASE_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`   Database: ${maskedUrl.split('@')[1] || maskedUrl}`);
    
    client = await pool.connect();
    const result = await client.query('SELECT NOW(), version()');
    const serverTime = result.rows[0].now;
    
    console.log(`✅ PostgreSQL connection successful!`);
    console.log(`   Server time: ${serverTime}`);
    
    return true;
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get recent logs from PostgreSQL (last N minutes)
export async function getRecentLogs(minutes: number = 15): Promise<any[]> {
  const client = await pool.connect();
  try {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    const result = await client.query(`
      SELECT 
        id,
        timestamp,
        level,
        message,
        service,
        metadata
      FROM logs
      WHERE timestamp >= $1
      ORDER BY timestamp DESC
      LIMIT 100
    `, [cutoffTime]);
    
    return result.rows;
  } finally {
    client.release();
  }
}

// Get recent traces from PostgreSQL (last N minutes)
export async function getRecentTraces(minutes: number = 15): Promise<any[]> {
  const client = await pool.connect();
  try {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    const result = await client.query(`
      SELECT 
        trace_id,
        service,
        operation,
        start_time,
        duration,
        status_code,
        spans
      FROM traces
      WHERE start_time >= $1
      ORDER BY start_time DESC
      LIMIT 50
    `, [cutoffTime]);
    
    return result.rows;
  } finally {
    client.release();
  }
}

// Close database connection pool
export async function closeDatabase(): Promise<void> {
  await pool.end();
}

