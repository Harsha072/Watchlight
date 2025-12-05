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

// Save AI analysis to database
export async function saveAIAnalysis(
  provider: string,
  analysis: string,
  severity: string,
  metric: string,
  message: string,
  timestamp: string
): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    console.log(`💾 [saveAIAnalysis] Attempting to save AI analysis to database...`);
    console.log(`   Provider: ${provider}, Metric: ${metric}, Severity: ${severity}`);
    
    // Ensure ai_analysis table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_analysis (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(50) NOT NULL,
        analysis TEXT NOT NULL,
        severity VARCHAR(20),
        metric VARCHAR(50),
        message TEXT,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on timestamp if it doesn't exist
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_timestamp ON ai_analysis(timestamp)
    `);
    
    console.log(`   📝 Executing INSERT query...`);
    const result = await client.query(
      `INSERT INTO ai_analysis (provider, analysis, severity, metric, message, timestamp) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [provider, analysis, severity, metric, message, timestamp]
    );
    
    const savedId = result.rows[0]?.id;
    if (!savedId) {
      throw new Error('INSERT query did not return an ID - save may have failed');
    }
    
    console.log(`✅ AI analysis saved to database successfully!`);
    console.log(`   - ID: ${savedId}`);
    console.log(`   - Provider: ${provider}`);
    console.log(`   - Metric: ${metric}`);
    console.log(`   - Timestamp: ${timestamp}`);
    
    // Verify the save by querying it back
    try {
      const verifyResult = await client.query(
        'SELECT id, timestamp, provider, metric FROM ai_analysis WHERE id = $1',
        [savedId]
      );
      if (verifyResult.rows.length === 0) {
        console.warn(`   ⚠️  WARNING: Could not verify saved record (ID: ${savedId})`);
      } else {
        console.log(`   ✅ Verified: Record exists in database`);
      }
    } catch (verifyError: any) {
      console.warn(`   ⚠️  Could not verify save: ${verifyError.message}`);
    }
  } catch (error: any) {
    console.error('❌ Failed to save AI analysis to database:', error.message);
    console.error('   Error details:', error);
    if (error.stack) {
      console.error('   Stack:', error.stack);
    }
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Close database connection pool
export async function closeDatabase(): Promise<void> {
  await pool.end();
}

