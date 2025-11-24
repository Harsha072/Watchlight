import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';
import { testConnection, initializeDatabase, saveMetrics, closeDatabase } from './services/database';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const QUEUE_URL = process.env.METRICS_QUEUE_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

interface MetricMessage {
  timestamp: string;
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

// Process a single metrics message
// Returns true if message was processed, false if it should be skipped
async function processMetricMessage(messageBody: string, messageAttributes?: any): Promise<boolean> {
  try {
    // Parse the message body (SNS wraps it, so we need to extract it)
    let parsedMessage: any;
    
    // First, parse the SQS message body
    const sqsMessage = JSON.parse(messageBody);
    
    // Check if this is an SNS notification (when SNS delivers to SQS)
    if (sqsMessage.Type === 'Notification' && sqsMessage.Message) {
      // This is an SNS notification, extract the actual message
      parsedMessage = JSON.parse(sqsMessage.Message);
    } else if (sqsMessage.Message) {
      // Alternative SNS format
      parsedMessage = JSON.parse(sqsMessage.Message);
    } else {
      // Direct message (not wrapped in SNS)
      parsedMessage = sqsMessage;
    }

    // Check message type - skip if not a metrics message
    // Check SNS MessageAttributes first
    if (sqsMessage.MessageAttributes && sqsMessage.MessageAttributes.type) {
      const messageType = sqsMessage.MessageAttributes.type.Value || sqsMessage.MessageAttributes.type;
      if (messageType !== 'metric') {
        // Not a metrics message, skip it
        return false;
      }
    }
    
    // Check message structure - must have 'metrics' field
    if (!parsedMessage.metrics) {
      // Not a metrics message, skip it silently
      return false;
    }

    const metricData: MetricMessage = parsedMessage;

    // Validate required fields
    if (!metricData.timestamp) {
      metricData.timestamp = new Date().toISOString();
    }
    if (!metricData.service) {
      throw new Error('Service name is required but missing');
    }
    if (!metricData.metrics) {
      throw new Error('Metrics data is required but missing');
    }

    const metrics = metricData.metrics;

    console.log(`[${new Date().toISOString()}] Processing metrics:`, {
      service: metricData.service,
      requests: metrics.request_count,
      errors: metrics.error_count,
      avgResponseTime: metrics.avg_response_time_ms,
      cpu: metrics.cpu_usage_percent,
      memory: metrics.memory_usage_percent,
    });

    // Save to database
    await saveMetricsToDatabase(metricData);

    console.log('✅ DB was saved successfully');
    return true;
  } catch (error: any) {
    console.error('❌ Error processing metrics message:', error.message);
    console.error('   Raw message body:', messageBody.substring(0, 200)); // Show first 200 chars for debugging
    throw error;
  }
}

// Save metrics to database
async function saveMetricsToDatabase(metricData: MetricMessage): Promise<void> {
  try {
    const metrics = metricData.metrics;
    
    await saveMetrics(
      metricData.timestamp,
      metricData.service,
      metrics.request_count,
      metrics.error_count,
      metrics.avg_response_time_ms,
      metrics.p95_response_time_ms,
      metrics.p99_response_time_ms,
      metrics.cpu_usage_percent,
      metrics.memory_usage_percent,
      metrics.active_connections,
      metrics.throughput_bytes_per_sec
    );
    
    console.log(`📊 Metrics saved to database: ${metricData.service} - ${metrics.request_count} requests, ${metrics.error_count} errors`);
  } catch (error: any) {
    console.error('❌ Failed to save metrics to database:', error.message);
    throw error;
  }
}


// Poll SQS for messages
async function pollSQS(): Promise<void> {
  const params = {
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20, // Long polling
    VisibilityTimeout: 30,
  };

  try {
    const result = await sqs.receiveMessage(params).promise();

    if (result.Messages && result.Messages.length > 0) {
      console.log(`📨 Received ${result.Messages.length} message(s)`);

      // Process each message
      for (const message of result.Messages) {
        if (message.Body && message.ReceiptHandle) {
          try {
            const processed = await processMetricMessage(message.Body, message.MessageAttributes);
            
            if (!processed) {
              // Message was skipped (not a metrics message), delete it anyway
              await sqs
                .deleteMessage({
                  QueueUrl: QUEUE_URL,
                  ReceiptHandle: message.ReceiptHandle,
                })
                .promise();
              // Silently skip - this is expected when SNS fans out to all queues
              continue;
            }

            // Delete message from queue after successful processing
            await sqs
              .deleteMessage({
                QueueUrl: QUEUE_URL,
                ReceiptHandle: message.ReceiptHandle,
              })
              .promise();

            console.log('✅ Message processed and deleted from queue');
          } catch (error) {
            console.error('❌ Error processing message, will retry:', error);
            // Message will become visible again after VisibilityTimeout
          }
        }
      }
    }
  } catch (error) {
    console.error('Error polling SQS:', error);
    // Wait a bit before retrying
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Main consumer loop
async function consumeMetrics() {
  console.log('🚀 Metrics service starting...');
  console.log(`📡 Queue URL: ${QUEUE_URL}`);

  // Check database connection
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL not set in environment variables');
    process.exit(1);
  }

  // Test and verify database connection
  const maxRetries = 5;
  let retries = 0;
  let connected = false;

  while (retries < maxRetries && !connected) {
    connected = await testConnection();
    if (!connected) {
      retries++;
      if (retries < maxRetries) {
        console.log(`⏳ Retrying database connection (${retries}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  if (!connected) {
    console.error('❌ Failed to connect to PostgreSQL after multiple retries');
    console.error('   Please check:');
    console.error('   1. Docker container is running: docker-compose ps');
    console.error('   2. DATABASE_URL is correct in .env file');
    console.error('   3. PostgreSQL is healthy: docker-compose logs postgres');
    process.exit(1);
  }

  // Initialize database tables
  try {
    await initializeDatabase();
  } catch (error: any) {
    console.error('❌ Failed to initialize database:', error.message);
    process.exit(1);
  }

  // Check SQS queue
  if (!QUEUE_URL) {
    console.error('❌ METRICS_QUEUE_URL not set in environment variables');
    process.exit(1);
  }

  // Verify queue exists
  try {
    await sqs.getQueueAttributes({ QueueUrl: QUEUE_URL, AttributeNames: ['QueueArn'] }).promise();
    console.log('✅ Connected to SQS queue');
  } catch (error) {
    console.error('❌ Failed to connect to SQS queue:', error);
    console.error('Make sure LocalStack is running and the queue is created');
    process.exit(1);
  }

  console.log('✅ Metrics service ready to consume messages');
  console.log('🔄 Starting polling loop...\n');

  // Start polling loop
  while (true) {
    await pollSQS();
    // Small delay to prevent tight loop if no messages
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Start consuming metrics
consumeMetrics().catch((error) => {
  console.error('❌ Error starting metrics service:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Metrics service shutting down...');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Metrics service shutting down...');
  await closeDatabase();
  process.exit(0);
});
