import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';

dotenv.config();

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
});

const QUEUE_URL = process.env.LOGS_QUEUE_URL || '';

// TODO: Implement logs consumer logic
// This service will consume messages from SQS queue
// Process log data and store in database

async function consumeLogs() {
  console.log('Logs service starting...');
  
  // TODO: Implement SQS message polling
  // TODO: Parse logs from message
  // TODO: Store logs in database
  // TODO: Handle errors and retries
  
  console.log('Logs service ready to consume messages');
}

// Start consuming logs
consumeLogs().catch((error) => {
  console.error('Error starting logs service:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Logs service shutting down...');
  process.exit(0);
});

