#!/bin/bash

# LocalStack setup script for SNS/SQS
# This script creates the necessary SNS topics and SQS queues for the observability mesh

set -e

ENDPOINT="http://localhost:4566"
REGION="us-east-1"

echo "Setting up LocalStack SNS/SQS infrastructure..."

# Create SNS Topic
echo "Creating SNS topic: observability-topic"
TOPIC_ARN=$(aws --endpoint-url=$ENDPOINT sns create-topic \
  --name observability-topic \
  --region $REGION \
  --output text --query 'TopicArn')

echo "Topic ARN: $TOPIC_ARN"

# Create SQS Queues
echo "Creating SQS queues..."

METRICS_QUEUE_URL=$(aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name metrics-queue \
  --region $REGION \
  --output text --query 'QueueUrl')
echo "Metrics Queue URL: $METRICS_QUEUE_URL"

LOGS_QUEUE_URL=$(aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name logs-queue \
  --region $REGION \
  --output text --query 'QueueUrl')
echo "Logs Queue URL: $LOGS_QUEUE_URL"

TRACE_QUEUE_URL=$(aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name trace-queue \
  --region $REGION \
  --output text --query 'QueueUrl')
echo "Trace Queue URL: $TRACE_QUEUE_URL"

AI_ANALYZER_QUEUE_URL=$(aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name ai-analyzer-queue \
  --region $REGION \
  --output text --query 'QueueUrl')
echo "AI Analyzer Queue URL: $AI_ANALYZER_QUEUE_URL"

NOTIFY_QUEUE_URL=$(aws --endpoint-url=$ENDPOINT sqs create-queue \
  --queue-name notify-queue \
  --region $REGION \
  --output text --query 'QueueUrl')
echo "Notify Queue URL: $NOTIFY_QUEUE_URL"

# Get Queue ARNs for subscription
METRICS_QUEUE_ARN=$(aws --endpoint-url=$ENDPOINT sqs get-queue-attributes \
  --queue-url $METRICS_QUEUE_URL \
  --attribute-names QueueArn \
  --region $REGION \
  --output text --query 'Attributes.QueueArn')

LOGS_QUEUE_ARN=$(aws --endpoint-url=$ENDPOINT sqs get-queue-attributes \
  --queue-url $LOGS_QUEUE_URL \
  --attribute-names QueueArn \
  --region $REGION \
  --output text --query 'Attributes.QueueArn')

TRACE_QUEUE_ARN=$(aws --endpoint-url=$ENDPOINT sqs get-queue-attributes \
  --queue-url $TRACE_QUEUE_URL \
  --attribute-names QueueArn \
  --region $REGION \
  --output text --query 'Attributes.QueueArn')

# Subscribe queues to SNS topic
echo "Subscribing queues to SNS topic..."

aws --endpoint-url=$ENDPOINT sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sqs \
  --notification-endpoint $METRICS_QUEUE_ARN \
  --region $REGION

aws --endpoint-url=$ENDPOINT sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sqs \
  --notification-endpoint $LOGS_QUEUE_ARN \
  --region $REGION

aws --endpoint-url=$ENDPOINT sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol sqs \
  --notification-endpoint $TRACE_QUEUE_ARN \
  --region $REGION

echo ""
echo "LocalStack setup complete!"
echo ""
echo "Topic ARN: $TOPIC_ARN"
echo "Metrics Queue: $METRICS_QUEUE_URL"
echo "Logs Queue: $LOGS_QUEUE_URL"
echo "Trace Queue: $TRACE_QUEUE_URL"
echo "AI Analyzer Queue: $AI_ANALYZER_QUEUE_URL"
echo "Notify Queue: $NOTIFY_QUEUE_URL"

