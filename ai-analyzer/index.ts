import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';
import axios from 'axios';
import path from 'path';
import { testConnection, initializeDatabase, saveAnalysis, closeDatabase } from './services/database';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const QUEUE_URL = process.env.AI_ANALYZER_QUEUE_URL || '';
const NOTIFY_QUEUE_URL = process.env.NOTIFY_QUEUE_URL || '';
const DATABASE_URL = process.env.DATABASE_URL || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// Groq model - can be overridden via GROQ_MODEL env var
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

interface ObservabilityData {
  metrics?: any;
  logs?: any;
  traces?: any;
  timestamp?: string;
}

interface AnalysisResult {
  provider: 'groq' | 'openai';
  analysis: string;
  anomalies?: string[];
  insights?: string[];
  timestamp: string;
}

// Analyze with Groq API
async function analyzeWithGroq(data: ObservabilityData): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const prompt = `You are an observability expert. Analyze the following observability data and provide Deep insights:
  
Metrics: ${JSON.stringify(data.metrics || {}, null, 2)}
Logs: ${JSON.stringify(data.logs || {}, null, 2)}
Traces: ${JSON.stringify(data.traces || {}, null, 2)}

Provide:
1. Key insights about system health
2. Any anomalies or issues detected
3. Recommendations for improvement

Keep the response concise and actionable.`;

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are an expert observability analyst specializing in API monitoring and performance analysis.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0]?.message?.content || 'No analysis generated';
  } catch (error: any) {
    console.error('Groq API error:', error.response?.data || error.message);
    throw new Error(`Groq analysis failed: ${error.message}`);
  }
}

// Analyze with OpenAI API
async function analyzeWithOpenAI(data: ObservabilityData): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = `You are an observability expert. Analyze the following observability data and provide insights:

Metrics: ${JSON.stringify(data.metrics || {}, null, 2)}
Logs: ${JSON.stringify(data.logs || {}, null, 2)}
Traces: ${JSON.stringify(data.traces || {}, null, 2)}

Provide:
1. Key insights about system health
2. Any anomalies or issues detected
3. Recommendations for improvement

Keep the response concise and actionable.`;

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert observability analyst specializing in API monitoring and performance analysis.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0]?.message?.content || 'No analysis generated';
  } catch (error: any) {
    console.error('OpenAI API error:', error.response?.data || error.message);
    throw new Error(`OpenAI analysis failed: ${error.message}`);
  }
}

// Process analysis with both AI providers
async function processAnalysis(data: ObservabilityData): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];

  // Try Groq first (faster)
  if (GROQ_API_KEY) {
    try {
      console.log(`🤖 Analyzing with Groq (model: ${GROQ_MODEL})...`);
      const groqAnalysis = await analyzeWithGroq(data);
      results.push({
        provider: 'groq',
        analysis: groqAnalysis,
        timestamp: new Date().toISOString(),
      });
      console.log('✅ Groq analysis complete');
    } catch (error: any) {
      console.error('❌ Groq analysis failed:', error.message);
    }
  }

  // Try OpenAI (more detailed)
  if (OPENAI_API_KEY) {
    try {
      console.log('🤖 Analyzing with OpenAI...');
      const openaiAnalysis = await analyzeWithOpenAI(data);
      results.push({
        provider: 'openai',
        analysis: openaiAnalysis,
        timestamp: new Date().toISOString(),
      });
      console.log('✅ OpenAI analysis complete');
    } catch (error: any) {
      console.error('❌ OpenAI analysis failed:', error.message);
    }
  }

  return results;
}

// Store analysis results to database
async function saveAnalysisResults(results: AnalysisResult[], originalData: ObservabilityData): Promise<void> {
  console.log('\n📊 Analysis Results:');
  
  for (const result of results) {
    console.log(`\n[${result.provider.toUpperCase()}]`);
    console.log(result.analysis);
    
    // Save to database
    try {
      await saveAnalysis(
        result.provider,
        result.analysis,
        result.anomalies || null,
        result.insights || null,
        originalData,
        result.timestamp
      );
    } catch (error: any) {
      console.error(`❌ Failed to save ${result.provider} analysis to database:`, error.message);
    }
  }
  
  console.log('\n✅ Analysis results saved to database');
}

// Poll SQS for messages
async function pollSQS(): Promise<void> {
  const params = {
    QueueUrl: QUEUE_URL,
    MaxNumberOfMessages: 10,
    WaitTimeSeconds: 20, // Long polling
    VisibilityTimeout: 60, // Longer timeout for AI processing
  };

  try {
    const result = await sqs.receiveMessage(params).promise();

    if (result.Messages && result.Messages.length > 0) {
      console.log(`📨 Received ${result.Messages.length} message(s) for analysis`);

      for (const message of result.Messages) {
        if (message.Body && message.ReceiptHandle) {
          try {
            // Parse message
            let observabilityData: ObservabilityData;
            
            // First, parse the SQS message body
            const sqsMessage = JSON.parse(message.Body);
            
            // Check if this is an SNS notification (when SNS delivers to SQS)
            if (sqsMessage.Type === 'Notification' && sqsMessage.Message) {
              // This is an SNS notification, extract the actual message
              observabilityData = JSON.parse(sqsMessage.Message);
            } else if (sqsMessage.Message) {
              // Alternative SNS format
              observabilityData = JSON.parse(sqsMessage.Message);
            } else {
              // Direct message (not wrapped in SNS)
              observabilityData = sqsMessage;
            }

            // Validate that we have observability data
            if (!observabilityData.metrics && !observabilityData.logs && !observabilityData.traces) {
              console.warn('⚠️ Message does not contain observability data, skipping');
              // Delete message anyway to avoid reprocessing
              await sqs.deleteMessage({
                QueueUrl: QUEUE_URL,
                ReceiptHandle: message.ReceiptHandle!,
              }).promise();
              continue;
            }

            console.log('🔍 Processing observability data for AI analysis...');
            console.log(`   Metrics: ${observabilityData.metrics ? 'Yes' : 'No'}, Logs: ${observabilityData.logs ? 'Yes' : 'No'}, Traces: ${observabilityData.traces ? 'Yes' : 'No'}`);

            // Run AI analysis
            const analysisResults = await processAnalysis(observabilityData);

            if (analysisResults.length > 0) {
              // Save results to database
              await saveAnalysisResults(analysisResults, observabilityData);

              // Check for anomalies and trigger notifications
              if (hasAnomalies(analysisResults)) {
                await triggerNotification(analysisResults, observabilityData);
              }
            } else {
              console.warn('⚠️ No analysis results generated');
            }

            // Delete message from queue
            await sqs
              .deleteMessage({
                QueueUrl: QUEUE_URL,
                ReceiptHandle: message.ReceiptHandle,
              })
              .promise();

            console.log('✅ Analysis complete and message deleted from queue');
          } catch (error: any) {
            console.error('❌ Error processing message, will retry:', error.message);
            // Message will become visible again after VisibilityTimeout
          }
        }
      }
    }
  } catch (error: any) {
    console.error('Error polling SQS:', error.message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

// Check if analysis results contain anomalies
function hasAnomalies(results: AnalysisResult[]): boolean {
  for (const result of results) {
    // Check if analysis mentions errors, anomalies, or issues
    const analysisLower = result.analysis.toLowerCase();
    const hasErrorKeywords = 
      analysisLower.includes('error') ||
      analysisLower.includes('anomaly') ||
      analysisLower.includes('issue') ||
      analysisLower.includes('problem') ||
      analysisLower.includes('critical') ||
      analysisLower.includes('failure') ||
      analysisLower.includes('alert');
    
    if (hasErrorKeywords || (result.anomalies && result.anomalies.length > 0)) {
      return true;
    }
  }
  return false;
}

// Trigger notification to Notify Service
async function triggerNotification(results: AnalysisResult[], originalData: ObservabilityData): Promise<void> {
  if (!NOTIFY_QUEUE_URL) {
    console.warn('⚠️ NOTIFY_QUEUE_URL not configured, skipping notification');
    return;
  }

  try {
    // Prepare notification payload
    const notificationData = {
      timestamp: new Date().toISOString(),
      severity: 'warning', // Can be: info, warning, error, critical
      message: 'Anomalies detected in observability data',
      analysis: results.map(r => ({
        provider: r.provider,
        summary: r.analysis.substring(0, 500), // First 500 chars
        anomalies: r.anomalies || [],
        insights: r.insights || [],
      })),
      observabilityData: {
        hasMetrics: !!originalData.metrics,
        hasLogs: !!originalData.logs,
        hasTraces: !!originalData.traces,
      },
    };

    // Send message to Notify Service queue
    await sqs.sendMessage({
      QueueUrl: NOTIFY_QUEUE_URL,
      MessageBody: JSON.stringify(notificationData),
      MessageAttributes: {
        severity: {
          DataType: 'String',
          StringValue: notificationData.severity,
        },
        type: {
          DataType: 'String',
          StringValue: 'anomaly-alert',
        },
      },
    }).promise();

    console.log('📢 Notification sent to Notify Service');
  } catch (error: any) {
    console.error('❌ Failed to send notification:', error.message);
    // Don't throw - we don't want to fail analysis if notification fails
  }
}

// Main processing loop
async function processAnalysisLoop() {
  console.log('🚀 AI Analyzer service starting...');
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
    process.exit(1);
  }

  // Initialize database tables
  try {
    await initializeDatabase();
  } catch (error: any) {
    console.error('❌ Failed to initialize database:', error.message);
    process.exit(1);
  }

  // Check API keys
  console.log('🔑 Checking API keys...');
  console.log(`   GROQ_API_KEY: ${GROQ_API_KEY ? '✅ Configured' : '❌ Not found'}`);
  console.log(`   OPENAI_API_KEY: ${OPENAI_API_KEY ? '✅ Configured' : '❌ Not found'}`);
  
  if (!GROQ_API_KEY && !OPENAI_API_KEY) {
    console.warn('⚠️ No AI API keys configured. Set GROQ_API_KEY or OPENAI_API_KEY in .env file');
    console.warn('   The service will start but cannot perform AI analysis');
  } else {
    if (GROQ_API_KEY) {
      console.log('✅ Groq API key configured');
    }
    if (OPENAI_API_KEY) {
      console.log('✅ OpenAI API key configured');
    }
  }

  if (!QUEUE_URL) {
    console.error('❌ AI_ANALYZER_QUEUE_URL not set in environment variables');
    process.exit(1);
  }

  // Verify queue exists
  try {
    await sqs.getQueueAttributes({ QueueUrl: QUEUE_URL, AttributeNames: ['QueueArn'] }).promise();
    console.log('✅ Connected to SQS queue');
  } catch (error: any) {
    console.error('❌ Failed to connect to SQS queue:', error.message);
    console.error('Make sure LocalStack is running and the queue is created');
    process.exit(1);
  }

  console.log('✅ AI Analyzer service ready');
  console.log('🔄 Starting analysis loop...\n');

  // Start polling loop
  while (true) {
    await pollSQS();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Start processing
processAnalysisLoop().catch((error) => {
  console.error('❌ Error starting AI analyzer service:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 AI Analyzer service shutting down...');
  await closeDatabase();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 AI Analyzer service shutting down...');
  await closeDatabase();
  process.exit(0);
});
