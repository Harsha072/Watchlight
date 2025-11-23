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
// For Render.com and other remote databases, SSL is required
const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased timeout for remote connections
  // SSL configuration: disable for local, enable for remote (like Render.com)
  ssl: isLocalDatabase ? false : {
    rejectUnauthorized: false, // Allow self-signed certificates (common for cloud providers like Render.com)
  },
});

// Test database connection
export async function testConnection(): Promise<boolean> {
  let client: PoolClient | null = null;
  try {
    console.log('🔌 Testing PostgreSQL connection...');
    const maskedUrl = DATABASE_URL.replace(/:[^:@]+@/, ':****@');
    console.log(`   Database: ${maskedUrl.split('@')[1] || maskedUrl}`); // Show only host part
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

    // Create logs table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        level VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        service VARCHAR(100),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index on timestamp for faster queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp DESC)
    `);

    // Create index on level for filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)
    `);

    // Create index on service for filtering
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service)
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

// Save log to database
export async function saveLog(
  timestamp: string,
  level: string,
  message: string,
  service?: string,
  metadata?: any
): Promise<void> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    await client.query(
      `INSERT INTO logs (timestamp, level, message, service, metadata) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        timestamp,
        level,
        message,
        service || null,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
  } catch (error: any) {
    console.error('❌ Error saving log to database:', error.message);
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

