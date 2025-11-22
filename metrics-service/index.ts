import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';

dotenv.config();

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
});

const QUEUE_URL = process.env.METRICS_QUEUE_URL || '';

// TODO: Implement metrics consumer logic
// This service will consume messages from SQS queue
// Process metrics data and store in database

async function consumeMetrics() {
  console.log('Metrics service starting...');
  
  // TODO: Implement SQS message polling
  // TODO: Parse metrics from message
  // TODO: Store metrics in database
  // TODO: Handle errors and retries
  
  console.log('Metrics service ready to consume messages');
}

// Start consuming metrics
consumeMetrics().catch((error) => {
  console.error('Error starting metrics service:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Metrics service shutting down...');
  process.exit(0);
});

