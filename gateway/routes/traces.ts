import { Router, Request, Response } from 'express';
import { SNS } from 'aws-sdk';
import dotenv from 'dotenv';
import path from 'path';
import { logToCloudWatch } from '../services/cloudwatch';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const router = Router();

const sns = new SNS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const TOPIC_ARN = process.env.OBSERVABILITY_TOPIC_ARN || '';

// POST /api/traces - Send trace data
router.post('/api/traces', async (req: Request, res: Response) => {
  try {
    const traceData = {
      traceId: req.body.traceId || `trace-${Date.now()}`,
      service: req.body.service || 'unknown',
      operation: req.body.operation || '',
      startTime: req.body.startTime || new Date().toISOString(),
      duration: req.body.duration || 0,
      statusCode: req.body.statusCode || 200,
      spans: req.body.spans || [],
    };

    // Validate required fields
    if (!traceData.traceId || !traceData.service || !traceData.operation) {
      return res.status(400).json({ error: 'TraceId, service, and operation are required' });
    }

    // Publish to SNS topic
    if (!TOPIC_ARN) {
      console.error('❌ OBSERVABILITY_TOPIC_ARN not found in environment variables');
      return res.status(500).json({ 
        error: 'SNS topic not configured',
        details: 'OBSERVABILITY_TOPIC_ARN environment variable is not set'
      });
    }

    // Log to CloudWatch BEFORE publishing to SNS
    await logToCloudWatch('trace', `${traceData.traceId} - ${traceData.operation}`, traceData);

    const params = {
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify(traceData),
      MessageAttributes: {
        type: {
          DataType: 'String',
          StringValue: 'trace',
        },
      },
    };

    await sns.publish(params).promise();

    console.log(`🔍 Published trace to SNS: ${traceData.traceId} - ${traceData.operation}`);

    res.status(200).json({
      success: true,
      message: 'Trace sent successfully',
      traceId: traceData.traceId,
    });
  } catch (error: any) {
    console.error('Error publishing trace to SNS:', error);
    res.status(500).json({
      error: 'Failed to send trace',
      message: error.message,
    });
  }
});

// GET /api/traces/health - Health check
router.get('/api/traces/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'traces-gateway',
    snsConfigured: !!TOPIC_ARN,
  });
});

export default router;

