import dotenv from 'dotenv';
import { SQS } from 'aws-sdk';
import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';

dotenv.config();

const sqs = new SQS({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.AWS_ENDPOINT || undefined, // For LocalStack
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const QUEUE_URL = process.env.AI_ANALYZER_QUEUE_URL || '';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Initialize Anthropic client
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

interface ObservabilityData {
  metrics?: any;
  logs?: any;
  traces?: any;
  timestamp?: string;
}

interface AnalysisResult {
  provider: 'groq' | 'claude';
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
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-70b-versatile',
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

// Analyze with Claude API
async function analyzeWithClaude(data: ObservabilityData): Promise<string> {
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY not configured');
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
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const content = message.content[0];
    if (content.type === 'text') {
      return content.text;
    }
    return 'No analysis generated';
  } catch (error: any) {
    console.error('Claude API error:', error.message);
    throw new Error(`Claude analysis failed: ${error.message}`);
  }
}

// Process analysis with both AI providers
async function processAnalysis(data: ObservabilityData): Promise<AnalysisResult[]> {
  const results: AnalysisResult[] = [];

  // Try Groq first (faster)
  if (GROQ_API_KEY) {
    try {
      console.log('🤖 Analyzing with Groq...');
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

  // Try Claude (more detailed)
  if (anthropic) {
    try {
      console.log('🤖 Analyzing with Claude...');
      const claudeAnalysis = await analyzeWithClaude(data);
      results.push({
        provider: 'claude',
        analysis: claudeAnalysis,
        timestamp: new Date().toISOString(),
      });
      console.log('✅ Claude analysis complete');
    } catch (error: any) {
      console.error('❌ Claude analysis failed:', error.message);
    }
  }

  return results;
}

// Store analysis results (simulate DB save)
async function saveAnalysisResults(results: AnalysisResult[], originalData: ObservabilityData): Promise<void> {
  // Simulate async database operation
  await new Promise((resolve) => setTimeout(resolve, 100));
  
  console.log('\n📊 Analysis Results:');
  results.forEach((result) => {
    console.log(`\n[${result.provider.toUpperCase()}]`);
    console.log(result.analysis);
  });
  
  // TODO: Store in database
  // await db.query('INSERT INTO ai_analysis (provider, analysis, data, timestamp) VALUES ...');
  
  console.log('\n✅ DB was saved successfully');
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
            
            try {
              observabilityData = JSON.parse(message.Body);
            } catch {
              const snsMessage = JSON.parse(message.Body);
              if (snsMessage.Message) {
                observabilityData = JSON.parse(snsMessage.Message);
              } else {
                observabilityData = snsMessage;
              }
            }

            console.log('🔍 Processing observability data for AI analysis...');

            // Run AI analysis
            const analysisResults = await processAnalysis(observabilityData);

            if (analysisResults.length > 0) {
              // Save results
              await saveAnalysisResults(analysisResults, observabilityData);

              // TODO: Check for anomalies and trigger notifications
              // if (hasAnomalies(analysisResults)) {
              //   await triggerNotification(analysisResults);
              // }
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

// Main processing loop
async function processAnalysisLoop() {
  console.log('🚀 AI Analyzer service starting...');
  console.log(`📡 Queue URL: ${QUEUE_URL}`);

  // Check API keys
  if (!GROQ_API_KEY && !ANTHROPIC_API_KEY) {
    console.warn('⚠️ No AI API keys configured. Set GROQ_API_KEY or ANTHROPIC_API_KEY');
  } else {
    if (GROQ_API_KEY) console.log('✅ Groq API key configured');
    if (ANTHROPIC_API_KEY) console.log('✅ Claude API key configured');
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
process.on('SIGTERM', () => {
  console.log('🛑 AI Analyzer service shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 AI Analyzer service shutting down...');
  process.exit(0);
});
