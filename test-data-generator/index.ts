import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const GENERATION_INTERVAL = parseInt(process.env.GENERATION_INTERVAL || '2000', 10); // 2 seconds default
const SCENARIO = process.env.SCENARIO || 'normal'; // normal, high-load, errors, slow, mixed, anomaly
const CONTINUOUS_MODE = process.env.CONTINUOUS_MODE === 'true'; // Set to 'true' for continuous generation
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '5', 10); // Number of logs to send in one batch

interface LogData {
  level: string;
  message: string;
  service: string;
  metadata?: any;
}

interface MetricData {
  service: string;
  metrics: {
    request_count: number;
    error_count: number;
    avg_response_time_ms: number;
    p95_response_time_ms: number;
    p99_response_time_ms: number;
    cpu_usage_percent: number;
    memory_usage_percent: number;
    active_connections: number;
    throughput_bytes_per_sec: number;
  };
}

interface TraceData {
  traceId: string;
  service: string;
  operation: string;
  startTime: string;
  duration: number;
  statusCode: number;
  spans: Array<{
    spanId: string;
    service: string;
    operation: string;
    duration: number;
    statusCode?: number;
  }>;
}

// Service configurations
const SERVICES = [
  { name: 'api-gateway', operations: ['GET /api/users', 'POST /api/orders', 'GET /api/products'] },
  { name: 'auth-service', operations: ['login', 'validateToken', 'refreshToken'] },
  { name: 'user-service', operations: ['getUser', 'createUser', 'updateUser'] },
  { name: 'order-service', operations: ['createOrder', 'getOrder', 'cancelOrder'] },
  { name: 'payment-service', operations: ['processPayment', 'refund', 'getPaymentStatus'] },
  { name: 'product-service', operations: ['getProduct', 'searchProducts', 'updateInventory'] },
  { name: 'notification-service', operations: ['sendEmail', 'sendSMS', 'pushNotification'] },
  { name: 'database', operations: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] },
];

const LOG_MESSAGES = {
  info: [
    'User logged in successfully',
    'Request processed successfully',
    'Cache hit for key',
    'Database query executed',
    'Payment processed',
    'Order created',
    'Email sent successfully',
    'User session created',
    'API rate limit check passed',
    'Health check passed',
  ],
  warn: [
    'High memory usage detected',
    'Slow database query detected',
    'API rate limit approaching',
    'Cache miss occurred',
    'Connection pool nearly exhausted',
    'Response time above threshold',
    'Retry attempt failed',
    'Deprecated API endpoint used',
    'Unusual request pattern detected',
  ],
  error: [
    'Database connection failed',
    'Payment processing failed',
    'Authentication failed',
    'Invalid request payload',
    'Service unavailable',
    'Timeout exceeded',
    'Out of memory',
    'Network error',
    'Invalid credentials',
    'Rate limit exceeded',
  ],
  debug: [
    'Processing request',
    'Cache lookup',
    'Database connection established',
    'Validating input',
    'Executing business logic',
    'Sending response',
  ],
};

// Scenario configurations
const SCENARIOS = {
  normal: {
    errorRate: 0.02, // 2% errors
    slowRequestRate: 0.05, // 5% slow requests
    requestRate: 1, // Normal request rate
    cpuBase: 40,
    memoryBase: 50,
  },
  'high-load': {
    errorRate: 0.05, // 5% errors
    slowRequestRate: 0.15, // 15% slow requests
    requestRate: 5, // 5x request rate
    cpuBase: 75,
    memoryBase: 80,
  },
  errors: {
    errorRate: 0.25, // 25% errors
    slowRequestRate: 0.10, // 10% slow requests
    requestRate: 1,
    cpuBase: 60,
    memoryBase: 65,
  },
  slow: {
    errorRate: 0.03, // 3% errors
    slowRequestRate: 0.30, // 30% slow requests
    requestRate: 1,
    cpuBase: 50,
    memoryBase: 55,
  },
  mixed: {
    errorRate: 0.10, // 10% errors
    slowRequestRate: 0.20, // 20% slow requests
    requestRate: 3, // 3x request rate
    cpuBase: 65,
    memoryBase: 70,
  },
  anomaly: {
    errorRate: 0.30, // 30% errors - HIGH to trigger anomaly detection
    slowRequestRate: 0.40, // 40% slow requests - HIGH latency
    requestRate: 2, // 2x request rate - volume spike
    cpuBase: 85, // High CPU usage
    memoryBase: 90, // High memory usage
  },
};

let scenarioConfig = SCENARIOS[SCENARIO as keyof typeof SCENARIOS] || SCENARIOS.normal;
let requestCounter = 0;
let errorCounter = 0;

// Generate random log
function generateLog(): LogData {
  const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
  const isError = Math.random() < scenarioConfig.errorRate;
  const isSlow = Math.random() < scenarioConfig.slowRequestRate;
  
  let level: 'info' | 'warn' | 'error' | 'debug';
  if (isError) {
    level = 'error';
    errorCounter++;
  } else if (isSlow) {
    level = 'warn';
  } else if (Math.random() < 0.1) {
    level = 'debug';
  } else {
    level = 'info';
  }

  const messages = LOG_MESSAGES[level];
  const message = messages[Math.floor(Math.random() * messages.length)];

  const metadata: any = {
    requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: new Date().toISOString(),
  };

  if (level === 'error') {
    metadata.errorCode = `ERR-${Math.floor(Math.random() * 1000)}`;
    metadata.stack = 'Error: Something went wrong\n    at function (file.js:123:45)';
  }

  if (isSlow) {
    metadata.responseTime = Math.floor(Math.random() * 2000) + 1000; // 1-3 seconds
    metadata.threshold = 500;
  }

  if (service.name === 'database') {
    metadata.queryTime = Math.floor(Math.random() * 500);
    metadata.rowsAffected = Math.floor(Math.random() * 100);
  }

  return {
    level,
    message,
    service: service.name,
    metadata,
  };
}

// Generate metrics
function generateMetrics(): MetricData {
  const service = SERVICES[Math.floor(Math.random() * SERVICES.length)];
  
  const baseRequestCount = Math.floor(Math.random() * 100) + 50;
  const requestCount = Math.floor(baseRequestCount * scenarioConfig.requestRate);
  const errorCount = Math.floor(requestCount * scenarioConfig.errorRate);
  
  const baseResponseTime = 100 + Math.random() * 200;
  // For anomaly scenario, make response times much higher
  const responseTimeMultiplier = SCENARIO === 'anomaly' ? 5 : (scenarioConfig.slowRequestRate > 0.2 ? 2 : 1);
  const avgResponseTime = baseResponseTime * responseTimeMultiplier;
  
  const cpuUsage = scenarioConfig.cpuBase + Math.random() * 20;
  const memoryUsage = scenarioConfig.memoryBase + Math.random() * 15;

  return {
    service: service.name,
    metrics: {
      request_count: requestCount,
      error_count: errorCount,
      avg_response_time_ms: Math.floor(avgResponseTime),
      p95_response_time_ms: Math.floor(avgResponseTime * 1.5),
      p99_response_time_ms: Math.floor(avgResponseTime * 2),
      cpu_usage_percent: Math.floor(cpuUsage),
      memory_usage_percent: Math.floor(memoryUsage),
      active_connections: Math.floor(Math.random() * 200) + 50,
      throughput_bytes_per_sec: Math.floor(Math.random() * 1000000) + 500000,
    },
  };
}

// Generate trace
function generateTrace(): TraceData {
  const traceId = `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const isError = Math.random() < scenarioConfig.errorRate;
  const isSlow = Math.random() < scenarioConfig.slowRequestRate;
  
  // Main service (entry point)
  const mainService = SERVICES[0]; // api-gateway
  const mainOperation = mainService.operations[Math.floor(Math.random() * mainService.operations.length)];
  
  // Generate child spans (service dependencies)
  const numSpans = Math.floor(Math.random() * 4) + 2; // 2-5 spans
  const spans: TraceData['spans'] = [];
  
  let totalDuration = 0;
  
  for (let i = 0; i < numSpans; i++) {
    const childService = SERVICES[Math.floor(Math.random() * (SERVICES.length - 1)) + 1]; // Skip api-gateway
    const childOperation = childService.operations[Math.floor(Math.random() * childService.operations.length)];
    
    let spanDuration: number;
    if (isSlow && i === 0) {
      // First span is slow
      spanDuration = Math.floor(Math.random() * 2000) + 1000;
    } else if (childService.name === 'database') {
      spanDuration = Math.floor(Math.random() * 200) + 50;
    } else {
      spanDuration = Math.floor(Math.random() * 300) + 100;
    }
    
    spans.push({
      spanId: `span-${i + 1}`,
      service: childService.name,
      operation: childOperation,
      duration: spanDuration,
      statusCode: isError && i === 0 ? 500 : 200,
    });
    
    totalDuration += spanDuration;
  }
  
  // Add some overhead for main service
  totalDuration += Math.floor(Math.random() * 100) + 50;
  
  return {
    traceId,
    service: mainService.name,
    operation: mainOperation,
    startTime: new Date().toISOString(),
    duration: totalDuration,
    statusCode: isError ? 500 : 200,
    spans,
  };
}

// Send data to gateway
async function sendLog(logData: LogData): Promise<void> {
  try {
    await axios.post(`${GATEWAY_URL}/api/logs`, logData);
    requestCounter++;
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.message || error.code || 'Unknown error';
    const statusCode = error.response?.status || 'N/A';
    console.error(`❌ Failed to send log: ${errorMsg} (Status: ${statusCode})`);
    if (error.code === 'ECONNREFUSED') {
      console.error(`   ⚠️  Gateway not reachable at ${GATEWAY_URL}. Is the gateway running?`);
    }
  }
}

async function sendMetrics(metricData: MetricData): Promise<void> {
  try {
    await axios.post(`${GATEWAY_URL}/api/metrics`, metricData);
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.message || error.code || 'Unknown error';
    const statusCode = error.response?.status || 'N/A';
    console.error(`❌ Failed to send metrics: ${errorMsg} (Status: ${statusCode})`);
    if (error.code === 'ECONNREFUSED') {
      console.error(`   ⚠️  Gateway not reachable at ${GATEWAY_URL}. Is the gateway running?`);
    }
  }
}

async function sendTrace(traceData: TraceData): Promise<void> {
  try {
    await axios.post(`${GATEWAY_URL}/api/traces`, traceData);
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.message || error.code || 'Unknown error';
    const statusCode = error.response?.status || 'N/A';
    console.error(`❌ Failed to send trace: ${errorMsg} (Status: ${statusCode})`);
    if (error.code === 'ECONNREFUSED') {
      console.error(`   ⚠️  Gateway not reachable at ${GATEWAY_URL}. Is the gateway running?`);
    }
  }
}

// Note: Services (Logs, Metrics, Trace) now automatically send processed data to AI Analyzer
// No need to send aggregated data directly from the generator

// Send a single batch of data
async function sendBatch(): Promise<void> {
  console.log('📤 Sending batch of test data...\n');

  // Send logs
  console.log('📝 Sending logs...');
  for (let i = 0; i < BATCH_SIZE; i++) {
    const log = generateLog();
    await sendLog(log);
    if (log.level === 'error') {
      console.log(`   ❌ [${log.service}] ${log.message}`);
    } else if (log.level === 'warn') {
      console.log(`   ⚠️  [${log.service}] ${log.message}`);
    } else {
      console.log(`   ℹ️  [${log.service}] ${log.message}`);
    }
    // Small delay between logs
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Send metrics
  console.log('\n📊 Sending metrics...');
  const metrics = generateMetrics();
  await sendMetrics(metrics);
  console.log(`   ✅ [${metrics.service}] Requests: ${metrics.metrics.request_count}, Errors: ${metrics.metrics.error_count}, CPU: ${metrics.metrics.cpu_usage_percent}%`);

  // Send trace
  console.log('\n🔍 Sending trace...');
  const trace = generateTrace();
  await sendTrace(trace);
  const status = trace.statusCode === 200 ? '✅' : '❌';
  console.log(`   ${status} [${trace.service}] ${trace.operation} - ${trace.duration}ms (${trace.spans.length} spans)`);

  console.log('\n✅ Batch sent successfully!');
  console.log(`📈 Total: ${requestCounter} requests sent, ${errorCounter} errors generated`);
}

// Main generation loop
async function generateData() {
  console.log('🚀 Test Data Generator Starting...');
  console.log(`   Gateway URL: ${GATEWAY_URL}`);
  console.log(`   Scenario: ${SCENARIO}`);
  console.log(`   Mode: ${CONTINUOUS_MODE ? 'Continuous' : 'Single Batch'}`);
  console.log(`   Batch Size: ${BATCH_SIZE} logs`);
  console.log(`   Error Rate: ${(scenarioConfig.errorRate * 100).toFixed(1)}%`);
  console.log(`   Slow Request Rate: ${(scenarioConfig.slowRequestRate * 100).toFixed(1)}%`);
  
  if (SCENARIO === 'anomaly') {
    console.log('\n⚠️  ANOMALY SCENARIO ACTIVE');
    console.log('   This scenario will generate data that should trigger anomaly detection:');
    console.log('   - High error rate (30%)');
    console.log('   - High latency (40% slow requests)');
    console.log('   - High CPU/Memory usage');
    console.log('   - Increased request volume');
    console.log('   Watch the auto-anomaly-detector logs to see if anomalies are detected!\n');
  }
  console.log('');

  if (CONTINUOUS_MODE) {
    // Continuous mode - send data repeatedly
    console.log('🔄 Continuous mode enabled - sending data repeatedly...\n');
    
    let iteration = 0;
    const interval = setInterval(async () => {
      iteration++;
      console.log(`\n--- Iteration ${iteration} ---`);
      
      // Generate and send logs (most frequent)
      const logCount = Math.floor(Math.random() * 3) + 1; // 1-3 logs per interval
      for (let i = 0; i < logCount; i++) {
        const log = generateLog();
        await sendLog(log);
        if (log.level === 'error') {
          console.log(`❌ [${log.service}] ${log.message}`);
        } else if (log.level === 'warn') {
          console.log(`⚠️  [${log.service}] ${log.message}`);
        }
      }

      // Generate and send metrics (every 5 iterations)
      if (iteration % 5 === 0) {
        const metrics = generateMetrics();
        await sendMetrics(metrics);
        console.log(`📊 [${metrics.service}] Requests: ${metrics.metrics.request_count}, Errors: ${metrics.metrics.error_count}, CPU: ${metrics.metrics.cpu_usage_percent}%`);
      }

      // Generate and send traces (every 3 iterations)
      if (iteration % 3 === 0) {
        const trace = generateTrace();
        await sendTrace(trace);
        const status = trace.statusCode === 200 ? '✅' : '❌';
        console.log(`${status} [${trace.service}] ${trace.operation} - ${trace.duration}ms (${trace.spans.length} spans)`);
      }

      // Summary every 20 iterations
      if (iteration % 20 === 0) {
        console.log(`\n📈 Summary: ${requestCounter} requests sent, ${errorCounter} errors generated\n`);
      }
    }, GENERATION_INTERVAL);

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      console.log('\n🛑 Stopping data generator...');
      clearInterval(interval);
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping data generator...');
      clearInterval(interval);
      process.exit(0);
    });
  } else {
    // Single batch mode - send once and exit
    console.log('📦 Single batch mode - sending data once and exiting...\n');
    
    try {
      await sendBatch();
      
      console.log('\n⏳ Waiting 2 seconds for services to process...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log('\n✅ Test data generation complete!');
      console.log('   You can now check the services to see if data was processed correctly.');
      console.log('   To send more data, run the generator again.');
      console.log('   To enable continuous mode, set CONTINUOUS_MODE=true in .env\n');
      
      process.exit(0);
    } catch (error: any) {
      console.error('❌ Error sending batch:', error.message);
      process.exit(1);
    }
  }
}

// Start generating
generateData().catch((error) => {
  console.error('❌ Error starting data generator:', error);
  process.exit(1);
});

