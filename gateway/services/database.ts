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
    client = await pool.connect();
    await client.query('SELECT NOW()');
    return true;
  } catch (error: any) {
    console.error('❌ Database connection test failed:', error.message);
    return false;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get logs with filtering
export async function getLogs(options: {
  limit?: number;
  level?: string;
  service?: string;
  startTime?: string;
  endTime?: string;
}): Promise<any[]> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    let query = 'SELECT * FROM logs WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (options.level) {
      query += ` AND level = $${paramIndex}`;
      params.push(options.level);
      paramIndex++;
    }

    if (options.service) {
      query += ` AND service = $${paramIndex}`;
      params.push(options.service);
      paramIndex++;
    }

    if (options.startTime) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(options.startTime);
      paramIndex++;
    }

    if (options.endTime) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(options.endTime);
      paramIndex++;
    }

    query += ' ORDER BY timestamp DESC';
    
    const limit = options.limit || 100;
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await client.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error('❌ Error fetching logs:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get metrics with filtering
export async function getMetrics(options: {
  limit?: number;
  service?: string;
  startTime?: string;
  endTime?: string;
}): Promise<any[]> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    let query = 'SELECT * FROM metrics WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (options.service) {
      query += ` AND service = $${paramIndex}`;
      params.push(options.service);
      paramIndex++;
    }

    if (options.startTime) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(options.startTime);
      paramIndex++;
    }

    if (options.endTime) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(options.endTime);
      paramIndex++;
    }

    query += ' ORDER BY timestamp DESC';
    
    const limit = options.limit || 50;
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await client.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error('❌ Error fetching metrics:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get traces with filtering
export async function getTraces(options: {
  limit?: number;
  traceId?: string;
  service?: string;
  startTime?: string;
  endTime?: string;
}): Promise<any[]> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    let query = 'SELECT * FROM traces WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (options.traceId) {
      query += ` AND trace_id = $${paramIndex}`;
      params.push(options.traceId);
      paramIndex++;
    }

    if (options.service) {
      query += ` AND service = $${paramIndex}`;
      params.push(options.service);
      paramIndex++;
    }

    if (options.startTime) {
      query += ` AND start_time >= $${paramIndex}`;
      params.push(options.startTime);
      paramIndex++;
    }

    if (options.endTime) {
      query += ` AND start_time <= $${paramIndex}`;
      params.push(options.endTime);
      paramIndex++;
    }

    query += ' ORDER BY start_time DESC';
    
    const limit = options.limit || 50;
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await client.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error('❌ Error fetching traces:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get AI analysis results
export async function getAIAnalysis(options: {
  limit?: number;
  startTime?: string;
  endTime?: string;
}): Promise<any[]> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    let query = 'SELECT * FROM ai_analysis WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (options.startTime) {
      query += ` AND timestamp >= $${paramIndex}`;
      params.push(options.startTime);
      paramIndex++;
    }

    if (options.endTime) {
      query += ` AND timestamp <= $${paramIndex}`;
      params.push(options.endTime);
      paramIndex++;
    }

    query += ' ORDER BY timestamp DESC';
    
    const limit = options.limit || 20;
    query += ` LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await client.query(query, params);
    return result.rows;
  } catch (error: any) {
    console.error('❌ Error fetching AI analysis:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Get dashboard statistics
export async function getDashboardStats(): Promise<any> {
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    
    // Get total logs count
    const logsResult = await client.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE level = \'error\') as errors FROM logs');
    const logsStats = logsResult.rows[0];

    // Get total metrics count
    const metricsResult = await client.query('SELECT COUNT(*) as total, COUNT(DISTINCT service) as services FROM metrics');
    const metricsStats = metricsResult.rows[0];

    // Get total traces count
    const tracesResult = await client.query('SELECT COUNT(*) as total, COUNT(DISTINCT service) as services FROM traces');
    const tracesStats = tracesResult.rows[0];

    // Get latest AI analysis
    const aiResult = await client.query('SELECT * FROM ai_analysis ORDER BY timestamp DESC LIMIT 1');
    const latestAI = aiResult.rows[0] || null;

    // Get recent error rate (last hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const errorRateResult = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE level = 'error') as errors,
        COUNT(*) as total
      FROM logs 
      WHERE timestamp >= $1
    `, [oneHourAgo]);
    const errorRate = errorRateResult.rows[0];

    return {
      logs: {
        total: parseInt(logsStats.total) || 0,
        errors: parseInt(logsStats.errors) || 0,
      },
      metrics: {
        total: parseInt(metricsStats.total) || 0,
        services: parseInt(metricsStats.services) || 0,
      },
      traces: {
        total: parseInt(tracesStats.total) || 0,
        services: parseInt(tracesStats.services) || 0,
      },
      aiAnalysis: {
        latest: latestAI,
        total: (await client.query('SELECT COUNT(*) as total FROM ai_analysis')).rows[0].total || 0,
      },
      errorRate: {
        errors: parseInt(errorRate.errors) || 0,
        total: parseInt(errorRate.total) || 0,
        percentage: errorRate.total > 0 ? ((parseInt(errorRate.errors) / parseInt(errorRate.total)) * 100).toFixed(2) : '0.00',
      },
    };
  } catch (error: any) {
    console.error('❌ Error fetching dashboard stats:', error.message);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Close database connection
export async function closeDatabase(): Promise<void> {
  await pool.end();
}

