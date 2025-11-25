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
    console.log('✅ PostgreSQL connection successful!');
    console.log(`   Server time: ${result.rows[0].now}`);
    console.log(`   PostgreSQL version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);
    return true;
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   💡 Tip: Make sure PostgreSQL is running: docker-compose up -d');
    } else if (error.message.includes('SSL/TLS')) {
      console.error('   💡 Tip: SSL error - check if database requires SSL connection');
    } else if (error.code === 'ENOTFOUND') {
      console.error('   💡 Tip: Database host not found - check DATABASE_URL');
    }
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Initialize database tables
export async function initializeDatabase(): Promise<void> {
  let client: PoolClient | null = null;
  try {
    console.log('📊 Initializing database tables...');
    client = await pool.connect();

    // Create metrics table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS metrics (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        service VARCHAR(100) NOT NULL,
        request_count INTEGER NOT NULL,
        error_count INTEGER NOT NULL,
        avg_response_time_ms INTEGER NOT NULL,
        p95_response_time_ms INTEGER NOT NULL,
        p99_response_time_ms INTEGER NOT NULL,
        cpu_usage_percent INTEGER NOT NULL,
        memory_usage_percent INTEGER NOT NULL,
        active_connections INTEGER NOT NULL,
        throughput_bytes_per_sec BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_service ON metrics(service)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_metrics_service_timestamp ON metrics(service, timestamp DESC)
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error: any) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Save metrics to database
export async function saveMetrics(
  timestamp: string,
  service: string,
  requestCount: number,
  errorCount: number,
  avgResponseTime: number,
  p95ResponseTime: number,
  p99ResponseTime: number,
  cpuUsage: number,
  memoryUsage: number,
  activeConnections: number,
  throughput: number
): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    await client.query(
      `INSERT INTO metrics (
        timestamp, service, request_count, error_count, 
        avg_response_time_ms, p95_response_time_ms, p99_response_time_ms,
        cpu_usage_percent, memory_usage_percent, active_connections, throughput_bytes_per_sec
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        timestamp,
        service,
        requestCount,
        errorCount,
        avgResponseTime,
        p95ResponseTime,
        p99ResponseTime,
        cpuUsage,
        memoryUsage,
        activeConnections,
        throughput,
      ]
    );
  } catch (error: any) {
    console.error('❌ Error saving metrics to database:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get database pool (for advanced queries if needed)
export function getPool(): Pool {
  return pool;
}

// Close database connections gracefully
export async function closeDatabase(): Promise<void> {
  try {
    await pool.end();
    console.log('✅ Database connections closed');
  } catch (error: any) {
    console.error('❌ Error closing database connections:', error.message);
  }
}

