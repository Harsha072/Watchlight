import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
// Groq model - can be overridden via GROQ_MODEL env var
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

interface AnomalyContext {
  anomaly: {
    metric: string;
    currentValue: number;
    expectedRange: { min: number; max: number };
    severity: string;
    message: string;
  };
  recentLogs: any[];
  recentTraces: any[];
  currentSummary: any;
}

/**
 * Analyze anomaly using Groq API
 * Fast and cost-effective for quick analysis
 */
async function analyzeWithGroq(context: AnomalyContext): Promise<string> {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY not configured');
  }

  const prompt = buildAnalysisPrompt(context);

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a senior DevOps engineer analyzing system anomalies. Provide clear, actionable root cause analysis.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      },
      {
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error: any) {
    console.error('❌ Groq API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Analyze anomaly using OpenAI API
 * Fallback option with more detailed analysis
 */
async function analyzeWithOpenAI(context: AnomalyContext): Promise<string> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not configured');
  }

  const prompt = buildAnalysisPrompt(context);

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a senior DevOps engineer analyzing system anomalies. Provide clear, actionable root cause analysis with complete postmortem.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error: any) {
    console.error('❌ OpenAI API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Build analysis prompt for AI
 * Provides context about the anomaly, logs, and traces
 */
function buildAnalysisPrompt(context: AnomalyContext): string {
  const { anomaly, recentLogs, recentTraces, currentSummary } = context;

  // Format recent logs (most relevant ones)
  const errorLogs = recentLogs
    .filter(log => log.level === 'error')
    .slice(0, 10)
    .map(log => `[${log.timestamp}] ${log.service}: ${log.message}`)
    .join('\n');

  // Format recent traces (failed or slow ones)
  const problematicTraces = recentTraces
    .filter(trace => trace.status_code >= 400 || trace.duration > 1000)
    .slice(0, 10)
    .map(trace => `[${trace.start_time}] ${trace.service}/${trace.operation}: ${trace.duration}ms, status ${trace.status_code}`)
    .join('\n');

  // Get service metrics
  const serviceMetrics = currentSummary.metrics
    ?.map((m: any) => `${m.service}: ${m.totalRequests} req, ${m.totalErrors} errors, ${m.p95Latency}ms P95`)
    .join('\n') || 'No metrics available';

  return `Analyze this system anomaly and provide a complete postmortem:

ANOMALY DETECTED:
- Metric: ${anomaly.metric}
- Current Value: ${anomaly.currentValue}
- Expected Range: ${anomaly.expectedRange.min} - ${anomaly.expectedRange.max}
- Severity: ${anomaly.severity}
- Message: ${anomaly.message}

RECENT ERROR LOGS:
${errorLogs || 'No error logs found'}

PROBLEMATIC TRACES:
${problematicTraces || 'No problematic traces found'}

CURRENT SERVICE METRICS:
${serviceMetrics}

Please provide:
1. ROOT CAUSE: What likely caused this anomaly? (be specific)
2. WHEN IT HAPPENED: Based on timestamps, when did the issue start?
3. WHY IT HAPPENED: Explain the underlying reason (e.g., code bug, resource exhaustion, external dependency)
4. IMPACT: What services/operations are affected?
5. RECOMMENDATIONS: What should developers do to fix or prevent this?

Format your response clearly so developers can understand and act on it.`;
}

/**
 * Main AI analysis function
 * Tries Groq first (faster), falls back to OpenAI if needed
 */
export async function analyzeAnomaly(context: AnomalyContext): Promise<{
  provider: string;
  analysis: string;
  timestamp: string;
}> {
  console.log('🤖 Starting AI analysis...');

  // Try Groq first (faster and cheaper)
  if (GROQ_API_KEY) {
    try {
      console.log(`   Using Groq API (model: ${GROQ_MODEL})...`);
      const analysis = await analyzeWithGroq(context);
      return {
        provider: 'groq',
        analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      console.warn('⚠️  Groq analysis failed, trying OpenAI...');
      // Fall through to OpenAI
    }
  }

  // Fallback to OpenAI
  if (OPENAI_API_KEY) {
    try {
      console.log('   Using OpenAI API...');
      const analysis = await analyzeWithOpenAI(context);
      return {
        provider: 'openai',
        analysis,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Both AI providers failed: ${error.message}`);
    }
  }

  throw new Error('No AI API keys configured (GROQ_API_KEY or OPENAI_API_KEY required)');
}

