// Simple JavaScript version - can be run with: node scripts/view-redis.js
// Make sure to install dependencies first: cd gateway && npm install

const { createClient } = require('redis');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;

// Construct Redis URL
let REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// If Upstash credentials are provided, construct the connection string
if (UPSTASH_REDIS_REST_TOKEN && UPSTASH_REDIS_REST_URL) {
  const hostname = UPSTASH_REDIS_REST_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  // Use rediss:// (with double 's') for TLS connections to Upstash
  REDIS_URL = `rediss://default:${UPSTASH_REDIS_REST_TOKEN}@${hostname}:6379`;
}

const isUpstashRedis = REDIS_URL.includes('upstash.io') || !!UPSTASH_REDIS_REST_TOKEN;

let redisConfig = {
  url: REDIS_URL,
};

if (isUpstashRedis) {
  redisConfig.socket = {
    tls: true,
    rejectUnauthorized: false,
  };
}

// Create Redis client
const redisClient = createClient(redisConfig);

redisClient.on('error', (err) => {
  console.error('❌ Redis Client Error:', err);
});

function formatTimestamp(timestamp) {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
}

function displayAggregatedSummary(key, summary) {
  console.log('\n' + '='.repeat(80));
  console.log(`📊 Key: ${key}`);
  console.log(`⏰ Timestamp: ${formatTimestamp(summary.timestamp)}`);
  console.log(`⏱️  Window: ${summary.windowMinutes} minutes`);
  console.log('='.repeat(80));

  // Logs Summary
  console.log('\n📋 LOGS SUMMARY:');
  console.log(`   Total Logs: ${summary.logs.totalCount}`);
  console.log(`   Error Logs: ${summary.logs.errorCount}`);
  console.log(`   Error Rate: ${summary.logs.totalCount > 0 ? ((summary.logs.errorCount / summary.logs.totalCount) * 100).toFixed(2) : 0}%`);
  
  if (Object.keys(summary.logs.byLevel).length > 0) {
    console.log('\n   By Level:');
    Object.entries(summary.logs.byLevel)
      .sort(([, a], [, b]) => b - a)
      .forEach(([level, count]) => {
        console.log(`     ${level.toUpperCase().padEnd(8)}: ${count}`);
      });
  }

  if (Object.keys(summary.logs.byService).length > 0) {
    console.log('\n   By Service:');
    Object.entries(summary.logs.byService)
      .sort(([, a], [, b]) => b.total - a.total)
      .forEach(([service, data]) => {
        console.log(`     ${service.padEnd(20)}: ${data.total} total, ${data.errors} errors`);
      });
  }

  // Metrics Summary
  if (summary.metrics && summary.metrics.length > 0) {
    console.log('\n📊 METRICS SUMMARY:');
    summary.metrics.forEach(metric => {
      console.log(`\n   Service: ${metric.service}`);
      console.log(`     Requests: ${metric.totalRequests}`);
      console.log(`     Errors: ${metric.totalErrors}`);
      console.log(`     Avg Response Time: ${metric.avgResponseTime.toFixed(2)}ms`);
      console.log(`     P95 Latency: ${metric.p95Latency.toFixed(2)}ms`);
      console.log(`     P99 Latency: ${metric.p99Latency.toFixed(2)}ms`);
      console.log(`     CPU: ${metric.avgCpu.toFixed(2)}%`);
      console.log(`     Memory: ${metric.avgMemory.toFixed(2)}%`);
      console.log(`     Connections: ${metric.maxConnections}`);
      console.log(`     Throughput: ${(metric.totalThroughput / 1024).toFixed(2)} KB/s`);
    });
  }

  // Traces Summary
  if (summary.traces && summary.traces.length > 0) {
    console.log('\n🔍 TRACES SUMMARY:');
    summary.traces.forEach(trace => {
      console.log(`\n   Service: ${trace.service} | Operation: ${trace.operation}`);
      console.log(`     Trace Count: ${trace.traceCount}`);
      console.log(`     Avg Duration: ${trace.avgDuration.toFixed(2)}ms`);
      console.log(`     P95 Duration: ${trace.p95Duration.toFixed(2)}ms`);
      console.log(`     P99 Duration: ${trace.p99Duration.toFixed(2)}ms`);
      console.log(`     Errors: ${trace.errorCount}`);
      console.log(`     Server Errors: ${trace.serverErrorCount}`);
    });
  }

  // Slow Endpoints
  if (summary.slowEndpoints && summary.slowEndpoints.length > 0) {
    console.log('\n🐌 SLOW ENDPOINTS:');
    summary.slowEndpoints
      .sort((a, b) => b.p95Duration - a.p95Duration)
      .slice(0, 10)
      .forEach(endpoint => {
        console.log(`     ${endpoint.service}/${endpoint.operation}: ${endpoint.p95Duration.toFixed(2)}ms (${endpoint.count} requests)`);
      });
  }

  // Request Volume
  if (summary.requestVolume) {
    console.log('\n📈 REQUEST VOLUME:');
    console.log(`   Total: ${summary.requestVolume.total}`);
    if (Object.keys(summary.requestVolume.byService).length > 0) {
      console.log('   By Service:');
      Object.entries(summary.requestVolume.byService)
        .sort(([, a], [, b]) => b - a)
        .forEach(([service, count]) => {
          console.log(`     ${service.padEnd(20)}: ${count}`);
        });
    }
  }

  console.log('\n' + '='.repeat(80) + '\n');
}

async function viewRedisData() {
  try {
    console.log('🔌 Connecting to Redis...');
    console.log(`   URL: ${REDIS_URL.replace(/:[^:@]+@/, ':****@')}`); // Hide password
    console.log(`   Type: ${isUpstashRedis ? 'Upstash (Cloud)' : 'Local'}\n`);

    await redisClient.connect();
    console.log('✅ Connected to Redis successfully!\n');

    // Get all keys
    console.log('🔍 Scanning for keys...');
    const allKeys = await redisClient.keys('*');
    console.log(`📊 Found ${allKeys.length} total key(s)\n`);

    if (allKeys.length === 0) {
      console.log('⚠️  No keys found in Redis database.');
      await redisClient.quit();
      return;
    }

    // Group keys by type
    const aggregatedKeys = allKeys.filter(k => k.startsWith('aggregated:'));
    const otherKeys = allKeys.filter(k => !k.startsWith('aggregated:'));

    console.log(`📈 Aggregated summaries: ${aggregatedKeys.length} key(s)`);
    console.log(`🔑 Other keys: ${otherKeys.length} key(s)\n`);

    // Display aggregated summaries
    if (aggregatedKeys.length > 0) {
      console.log('\n' + '═'.repeat(80));
      console.log('📊 AGGREGATED SUMMARIES');
      console.log('═'.repeat(80));

      // Sort aggregated keys by timestamp (newest first)
      const sortedKeys = aggregatedKeys.sort((a, b) => {
        // Extract timestamp from key
        const timeA = a.replace('aggregated:', '');
        const timeB = b.replace('aggregated:', '');
        return new Date(timeB).getTime() - new Date(timeA).getTime();
      });

      for (const key of sortedKeys) {
        try {
          const value = await redisClient.get(key);
          if (value) {
            const summary = JSON.parse(value);
            displayAggregatedSummary(key, summary);
          }
        } catch (error) {
          console.log(`\n⚠️  Failed to parse key ${key}: ${error.message}`);
          const rawValue = await redisClient.get(key);
          console.log(`   Raw value: ${rawValue?.substring(0, 100)}...\n`);
        }
      }
    }

    // Display other keys
    if (otherKeys.length > 0) {
      console.log('\n' + '═'.repeat(80));
      console.log('🔑 OTHER KEYS');
      console.log('═'.repeat(80));

      for (const key of otherKeys) {
        try {
          const value = await redisClient.get(key);
          console.log(`\n🔑 Key: ${key}`);
          
          if (value) {
            try {
              const parsed = JSON.parse(value);
              console.log('   Value (JSON):');
              console.log(JSON.stringify(parsed, null, 2));
            } catch {
              console.log(`   Value: ${value}`);
            }
          } else {
            console.log('   Value: (empty or not a string)');
          }
        } catch (error) {
          console.log(`\n⚠️  Error reading key ${key}: ${error.message}`);
        }
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(80));
    console.log(`Total Keys: ${allKeys.length}`);
    console.log(`Aggregated Keys: ${aggregatedKeys.length}`);
    console.log(`Other Keys: ${otherKeys.length}`);
    console.log('═'.repeat(80) + '\n');

    await redisClient.quit();
    console.log('✅ Disconnected from Redis');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Delete all data from Redis (for testing purposes)
async function deleteAllRedisData() {
  try {
    console.log('🔌 Connecting to Redis...');
    console.log(`   URL: ${REDIS_URL.replace(/:[^:@]+@/, ':****@')}`); // Hide password
    console.log(`   Type: ${isUpstashRedis ? 'Upstash (Cloud)' : 'Local'}\n`);

    await redisClient.connect();
    console.log('✅ Connected to Redis successfully!\n');

    // Get all keys
    console.log('🔍 Scanning for keys to delete...');
    const allKeys = await redisClient.keys('*');
    console.log(`📊 Found ${allKeys.length} total key(s) to delete\n`);

    if (allKeys.length === 0) {
      console.log('⚠️  No keys found in Redis database. Nothing to delete.');
      await redisClient.quit();
      return;
    }

    // Group keys by type for reporting
    const aggregatedKeys = allKeys.filter(k => k.startsWith('aggregated:'));
    const aiAnalysisKeys = allKeys.filter(k => k.startsWith('ai:analysis:'));
    const serviceKeys = allKeys.filter(k => k.startsWith('service:'));
    const otherKeys = allKeys.filter(k => 
      !k.startsWith('aggregated:') && 
      !k.startsWith('ai:analysis:') && 
      !k.startsWith('service:')
    );

    console.log('📋 Keys to be deleted:');
    console.log(`   - Aggregated summaries: ${aggregatedKeys.length}`);
    console.log(`   - AI Analysis: ${aiAnalysisKeys.length}`);
    console.log(`   - Service metrics: ${serviceKeys.length}`);
    console.log(`   - Other keys: ${otherKeys.length}`);
    console.log(`   - Total: ${allKeys.length}\n`);

    // Delete all keys
    console.log('🗑️  Deleting all keys...');
    let deletedCount = 0;
    let errorCount = 0;

    for (const key of allKeys) {
      try {
        await redisClient.del(key);
        deletedCount++;
      } catch (error) {
        console.error(`   ⚠️  Failed to delete key ${key}: ${error.message}`);
        errorCount++;
      }
    }

    console.log('\n' + '═'.repeat(80));
    console.log('🗑️  DELETION SUMMARY');
    console.log('═'.repeat(80));
    console.log(`✅ Successfully deleted: ${deletedCount} key(s)`);
    if (errorCount > 0) {
      console.log(`❌ Failed to delete: ${errorCount} key(s)`);
    }
    console.log('═'.repeat(80) + '\n');

    // Verify deletion
    const remainingKeys = await redisClient.keys('*');
    if (remainingKeys.length === 0) {
      console.log('✅ All data successfully deleted from Redis!');
    } else {
      console.log(`⚠️  Warning: ${remainingKeys.length} key(s) still remain in Redis`);
    }

    await redisClient.quit();
    console.log('✅ Disconnected from Redis');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Check command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Run the script based on command
if (command === 'delete' || command === '--delete' || command === '-d') {
  console.log('⚠️  WARNING: This will delete ALL data from Redis!');
  console.log('   This is for testing purposes only.\n');
  deleteAllRedisData();
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log('📖 Redis View Script Usage:');
  console.log('');
  console.log('  node scripts/view-redis.js          - View all Redis data');
  console.log('  node scripts/view-redis.js delete   - Delete all Redis data (for testing)');
  console.log('  node scripts/view-redis.js help     - Show this help message');
  console.log('');
} else {
  // Default: view data
  viewRedisData();
}

