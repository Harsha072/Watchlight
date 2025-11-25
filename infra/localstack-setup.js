const { SNS, SQS } = require('aws-sdk');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const ENDPOINT = process.env.AWS_ENDPOINT || 'http://localhost:4566';
const REGION = process.env.AWS_REGION || 'us-east-1';

// Configure AWS SDK for LocalStack
const snsConfig = {
  endpoint: ENDPOINT,
  region: REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
};

const sqsConfig = {
  endpoint: ENDPOINT,
  region: REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
};

const sns = new SNS(snsConfig);
const sqs = new SQS(sqsConfig);

async function setupLocalStack() {
  try {
    console.log('Setting up LocalStack SNS/SQS infrastructure...\n');

    // Create SNS Topic
    console.log('Creating SNS topic: observability-topic');
    const topicResult = await sns.createTopic({ Name: 'observability-topic' }).promise();
    const topicArn = topicResult.TopicArn;
    console.log(`Topic ARN: ${topicArn}\n`);

    // Create SQS Queues
    console.log('Creating SQS queues...');
    
    const metricsQueueResult = await sqs.createQueue({ QueueName: 'metrics-queue' }).promise();
    const metricsQueueUrl = metricsQueueResult.QueueUrl;
    console.log(`Metrics Queue URL: ${metricsQueueUrl}`);

    const logsQueueResult = await sqs.createQueue({ QueueName: 'logs-queue' }).promise();
    const logsQueueUrl = logsQueueResult.QueueUrl;
    console.log(`Logs Queue URL: ${logsQueueUrl}`);

    const traceQueueResult = await sqs.createQueue({ QueueName: 'trace-queue' }).promise();
    const traceQueueUrl = traceQueueResult.QueueUrl;
    console.log(`Trace Queue URL: ${traceQueueUrl}`);

    const aiAnalyzerQueueResult = await sqs.createQueue({ QueueName: 'ai-analyzer-queue' }).promise();
    const aiAnalyzerQueueUrl = aiAnalyzerQueueResult.QueueUrl;
    console.log(`AI Analyzer Queue URL: ${aiAnalyzerQueueUrl}`);

    const notifyQueueResult = await sqs.createQueue({ QueueName: 'notify-queue' }).promise();
    const notifyQueueUrl = notifyQueueResult.QueueUrl;
    console.log(`Notify Queue URL: ${notifyQueueUrl}\n`);

    // Get Queue ARNs for subscription
    console.log('Getting queue ARNs...');
    
    const metricsQueueAttrs = await sqs.getQueueAttributes({
      QueueUrl: metricsQueueUrl,
      AttributeNames: ['QueueArn']
    }).promise();
    const metricsQueueArn = metricsQueueAttrs.Attributes.QueueArn;

    const logsQueueAttrs = await sqs.getQueueAttributes({
      QueueUrl: logsQueueUrl,
      AttributeNames: ['QueueArn']
    }).promise();
    const logsQueueArn = logsQueueAttrs.Attributes.QueueArn;

    const traceQueueAttrs = await sqs.getQueueAttributes({
      QueueUrl: traceQueueUrl,
      AttributeNames: ['QueueArn']
    }).promise();
    const traceQueueArn = traceQueueAttrs.Attributes.QueueArn;

    const aiAnalyzerQueueAttrs = await sqs.getQueueAttributes({
      QueueUrl: aiAnalyzerQueueUrl,
      AttributeNames: ['QueueArn']
    }).promise();
    const aiAnalyzerQueueArn = aiAnalyzerQueueAttrs.Attributes.QueueArn;

    // Subscribe queues to SNS topic
    console.log('Subscribing queues to SNS topic...\n');
    
    await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: metricsQueueArn
    }).promise();
    console.log('✅ Metrics queue subscribed');

    await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: logsQueueArn
    }).promise();
    console.log('✅ Logs queue subscribed');

    await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: traceQueueArn
    }).promise();
    console.log('✅ Trace queue subscribed');

    await sns.subscribe({
      TopicArn: topicArn,
      Protocol: 'sqs',
      Endpoint: aiAnalyzerQueueArn
    }).promise();
    console.log('✅ AI Analyzer queue subscribed\n');

    // Set queue policy to allow SNS to send messages
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'sns.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: '*'
        }
      ]
    };

    await sqs.setQueueAttributes({
      QueueUrl: metricsQueueUrl,
      Attributes: {
        Policy: JSON.stringify(policy)
      }
    }).promise();

    await sqs.setQueueAttributes({
      QueueUrl: logsQueueUrl,
      Attributes: {
        Policy: JSON.stringify(policy)
      }
    }).promise();

    await sqs.setQueueAttributes({
      QueueUrl: traceQueueUrl,
      Attributes: {
        Policy: JSON.stringify(policy)
      }
    }).promise();

    await sqs.setQueueAttributes({
      QueueUrl: aiAnalyzerQueueUrl,
      Attributes: {
        Policy: JSON.stringify(policy)
      }
    }).promise();

    console.log('LocalStack setup complete!\n');
    console.log('Summary:');
    console.log(`  Topic ARN: ${topicArn}`);
    console.log(`  Metrics Queue: ${metricsQueueUrl}`);
    console.log(`  Logs Queue: ${logsQueueUrl}`);
    console.log(`  Trace Queue: ${traceQueueUrl}`);
    console.log(`  AI Analyzer Queue: ${aiAnalyzerQueueUrl}`);
    console.log(`  Notify Queue: ${notifyQueueUrl}\n`);
    console.log('✅ All queues are subscribed to the SNS topic and ready to receive messages!');

  } catch (error) {
    console.error('❌ Error setting up LocalStack:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Tip: Make sure LocalStack is running:');
      console.error('   docker-compose up -d localstack');
      console.error('   Wait a few seconds for it to start, then try again.');
    } else if (error.code === 'ENOTFOUND') {
      console.error('\n💡 Tip: Cannot connect to LocalStack. Check:');
      console.error('   1. LocalStack container is running: docker-compose ps');
      console.error('   2. AWS_ENDPOINT is correct in .env file');
    }
    process.exit(1);
  }
}

// Run setup
setupLocalStack();
