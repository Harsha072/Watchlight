import express from 'express';
import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';
import { testConnection, initializeDatabase, saveLog, closeDatabase } from './services/database';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3002;

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const QUEUE_URL = process.env.LOGS_QUEUE_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';

interface LogMessage {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  metadata?: any;
}

// Process a single log message
// Returns true if message was processed, false if it should be skipped
async function processLogMessage(messageBody: string, messageAttributes?: any): Promise<boolean> {
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

    // Check message type - skip if not a log message
    // Check SNS MessageAttributes first
    if (sqsMessage.MessageAttributes && sqsMessage.MessageAttributes.type) {
      const messageType = sqsMessage.MessageAttributes.type.Value || sqsMessage.MessageAttributes.type;
      if (messageType !== 'log') {
        // Not a log message, skip it
        return false;
      }
    }
    
    // Check message structure - must have 'level' and 'message' fields (log characteristics)
    if (!parsedMessage.level && !parsedMessage.message) {
      // Not a log message, skip it silently
      return false;
    }

    const logData: LogMessage = parsedMessage;

    // Validate required fields
    if (!logData.timestamp) {
      logData.timestamp = new Date().toISOString();
    }
    if (!logData.level) {
      logData.level = 'info';
    }
    if (!logData.message) {
      throw new Error('Log message is required but missing');
    }

    console.log(`[${new Date().toISOString()}] Processing log:`, {
      level: logData.level,
      message: logData.message,
      service: logData.service || 'unknown',
      timestamp: logData.timestamp,
    });

    // Save to database
    await saveLogToDatabase(logData);

    console.log('✅ DB was saved successfully');
    return true;
  } catch (error: any) {
    console.error('❌ Error processing log message:', error.message);
    console.error('   Raw message body:', messageBody.substring(0, 200)); // Show first 200 chars for debugging
    throw error;
  }
}

// Save log to database
async function saveLogToDatabase(logData: LogMessage): Promise<void> {
  try {
    await saveLog(
      logData.timestamp,
      logData.level,
      logData.message,
      logData.service,
      logData.metadata
    );
    console.log(`📝 Log saved to database: ${logData.level} - ${logData.message}`);
  } catch (error: any) {
    console.error('❌ Failed to save log to database:', error.message);
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
            const processed = await processLogMessage(message.Body, message.MessageAttributes);
            
            if (!processed) {
              // Message was skipped (not a log message), delete it anyway
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
async function consumeLogs() {
  console.log('🚀 Logs service starting...');
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

  console.log('🔍 Logs Service: Testing database connection...');
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
    console.error('❌ Logs Service: Failed to connect to PostgreSQL after multiple retries');
    console.error('   Please check:');
    console.error('   1. Docker container is running: docker-compose ps');
    console.error('   2. DATABASE_URL is correct in .env file');
    console.error('   3. PostgreSQL is healthy: docker-compose logs postgres');
    process.exit(1);
  }
  
  console.log('✅ Logs Service: Connected to PostgreSQL database');

  // Initialize database tables
  try {
    await initializeDatabase();
  } catch (error: any) {
    console.error('❌ Failed to initialize database:', error.message);
    process.exit(1);
  }

  // Check SQS queue
  if (!QUEUE_URL) {
    console.error('❌ LOGS_QUEUE_URL not set in environment variables');
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

  console.log('✅ Logs service ready to consume messages');
  console.log('🔄 Starting polling loop...\n');

  // Start polling loop
  while (true) {
    await pollSQS();
    // Small delay to prevent tight loop if no messages
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Health check endpoint (required for Render web service)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'logs-service',
    queueUrl: QUEUE_URL ? 'configured' : 'not configured',
    database: DATABASE_URL ? 'configured' : 'not configured',
  });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`🌐 Logs service HTTP server listening on port ${PORT}`);
  // Start the SQS polling in the background
  consumeLogs().catch((error) => {
    console.error('❌ Error starting logs service:', error);
    process.exit(1);
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Logs service shutting down...');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 Logs service shutting down...');
  await closeDatabase();
  process.exit(0);
});
