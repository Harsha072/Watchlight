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
    return true;
  } catch (error: any) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('   Connection refused. Is PostgreSQL running?');
    } else if (error.message.includes('SSL/TLS')) {
      console.error('   SSL/TLS required. Check your connection string.');
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
    client = await pool.connect();

    // Create AI analysis results table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_analysis (
        id SERIAL PRIMARY KEY,
        provider VARCHAR(50) NOT NULL,
        analysis TEXT NOT NULL,
        anomalies JSONB,
        insights JSONB,
        observability_data JSONB,
        timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on timestamp for filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_timestamp ON ai_analysis(timestamp)
    `);

    // Create index on provider
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_analysis_provider ON ai_analysis(provider)
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

// Save analysis result to database
export async function saveAnalysis(
  provider: string,
  analysis: string,
  anomalies: string[] | null,
  insights: string[] | null,
  observabilityData: any,
  timestamp: string
): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    await client.query(
      `INSERT INTO ai_analysis (provider, analysis, anomalies, insights, observability_data, timestamp) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        provider,
        analysis,
        anomalies ? JSON.stringify(anomalies) : null,
        insights ? JSON.stringify(insights) : null,
        JSON.stringify(observabilityData),
        timestamp,
      ]
    );
    
    console.log(`💾 Analysis saved to database: ${provider}`);
  } catch (error: any) {
    console.error('❌ Failed to save analysis to database:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Close database connection pool
export async function closeDatabase(): Promise<void> {
  try {
    await pool.end();
    console.log('✅ Database connection pool closed');
  } catch (error: any) {
    console.error('❌ Error closing database pool:', error.message);
  }
}

