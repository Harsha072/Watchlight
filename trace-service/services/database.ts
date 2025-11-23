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

    // Create traces table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS traces (
        id SERIAL PRIMARY KEY,
        trace_id VARCHAR(255) NOT NULL,
        service VARCHAR(100) NOT NULL,
        operation VARCHAR(255) NOT NULL,
        start_time TIMESTAMP NOT NULL,
        duration INTEGER NOT NULL,
        status_code INTEGER NOT NULL,
        spans JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create spans table for detailed span information (optional, for more detailed queries)
    await client.query(`
      CREATE TABLE IF NOT EXISTS trace_spans (
        id SERIAL PRIMARY KEY,
        trace_id VARCHAR(255) NOT NULL,
        span_id VARCHAR(255) NOT NULL,
        service VARCHAR(100) NOT NULL,
        operation VARCHAR(255) NOT NULL,
        duration INTEGER NOT NULL,
        status_code INTEGER,
        parent_span_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_traces_service ON traces(service)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_traces_start_time ON traces(start_time DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_traces_service_start_time ON traces(service, start_time DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trace_spans_trace_id ON trace_spans(trace_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_trace_spans_service ON trace_spans(service)
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

// Save trace to database
export async function saveTrace(
  traceId: string,
  service: string,
  operation: string,
  startTime: string,
  duration: number,
  statusCode: number,
  spans: any[]
): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    // Start transaction
    await client.query('BEGIN');

    // Insert main trace
    await client.query(
      `INSERT INTO traces (
        trace_id, service, operation, start_time, duration, status_code, spans
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        traceId,
        service,
        operation,
        startTime,
        duration,
        statusCode,
        JSON.stringify(spans),
      ]
    );

    // Insert individual spans for detailed querying
    for (const span of spans) {
      await client.query(
        `INSERT INTO trace_spans (
          trace_id, span_id, service, operation, duration, status_code, parent_span_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          traceId,
          span.spanId || `span-${Math.random().toString(36).substr(2, 9)}`,
          span.service,
          span.operation,
          span.duration,
          span.statusCode || null,
          span.parentSpanId || null,
        ]
      );
    }

    // Commit transaction
    await client.query('COMMIT');
  } catch (error: any) {
    // Rollback on error
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('❌ Error saving trace to database:', error.message);
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

