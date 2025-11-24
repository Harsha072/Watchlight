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
    console.log(`   Local database: ${isLocalDatabase ? 'Yes' : 'No'}`);
    if (isRenderDatabase) {
      console.log(`   Provider: Render.com`);
    }
    console.log(`   SSL: ${isLocalDatabase ? 'Disabled' : 'Enabled (required for remote)'}`);
    
    client = await pool.connect();
    const result = await client.query('SELECT NOW(), version()');
    const serverTime = result.rows[0].now;
    const version = result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1];
    
    console.log(`✅ PostgreSQL connection successful!`);
    console.log(`   Server time: ${serverTime}`);
    console.log(`   Version: ${version}`);
    
    return true;
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    if (error.code === 'ENOTFOUND') {
      console.error('   💡 Tip: Check if the database host is correct');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('   💡 Tip: Check if PostgreSQL is running and accessible');
    } else if (error.message.includes('SSL')) {
      console.error('   💡 Tip: Remote databases require SSL. Check your connection string.');
    }
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get aggregated logs data from the last N minutes
export async function getLogsData(minutes: number = 5): Promise<any[]> {
  const client = await pool.connect();
  try {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    const result = await client.query(`
      SELECT 
        service,
        level,
        COUNT(*) as count,
        COUNT(CASE WHEN level = 'error' THEN 1 END) as error_count
      FROM logs
      WHERE timestamp >= $1
      GROUP BY service, level
      ORDER BY service, level
    `, [cutoffTime]);
    
    return result.rows;
  } finally {
    client.release();
  }
}

// Get aggregated metrics data from the last N minutes
export async function getMetricsData(minutes: number = 5): Promise<any[]> {
  const client = await pool.connect();
  try {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    const result = await client.query(`
      SELECT 
        service,
        COUNT(*) as sample_count,
        SUM(request_count) as total_requests,
        SUM(error_count) as total_errors,
        AVG(avg_response_time_ms) as avg_response_time,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p95_response_time_ms) as p95_latency,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY p99_response_time_ms) as p99_latency,
        AVG(cpu_usage_percent) as avg_cpu,
        AVG(memory_usage_percent) as avg_memory,
        MAX(active_connections) as max_connections,
        SUM(throughput_bytes_per_sec) as total_throughput
      FROM metrics
      WHERE timestamp >= $1
      GROUP BY service
      ORDER BY service
    `, [cutoffTime]);
    
    return result.rows;
  } finally {
    client.release();
  }
}

// Get aggregated traces data from the last N minutes
export async function getTracesData(minutes: number = 5): Promise<{ traces: any[]; slowEndpoints: any[] }> {
  const client = await pool.connect();
  try {
    const cutoffTime = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    
    // Get trace-level aggregations
    const tracesResult = await client.query(`
      SELECT 
        service,
        operation,
        COUNT(*) as trace_count,
        AVG(duration) as avg_duration,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) as p95_duration,
        PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY duration) as p99_duration,
        COUNT(CASE WHEN status_code >= 400 THEN 1 END) as error_count,
        COUNT(CASE WHEN status_code >= 500 THEN 1 END) as server_error_count
      FROM traces
      WHERE start_time >= $1
      GROUP BY service, operation
      ORDER BY service, operation
    `, [cutoffTime]);
    
    // Get slow endpoints (P95 > 500ms)
    const slowEndpointsResult = await client.query(`
      SELECT 
        service,
        operation,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) as p95_duration,
        COUNT(*) as count
      FROM traces
      WHERE start_time >= $1
      GROUP BY service, operation
      HAVING PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration) > 500
      ORDER BY p95_duration DESC
      LIMIT 10
    `, [cutoffTime]);
    
    return {
      traces: tracesResult.rows,
      slowEndpoints: slowEndpointsResult.rows,
    };
  } finally {
    client.release();
  }
}

// Close database connection pool
export async function closeDatabase(): Promise<void> {
  await pool.end();
}

