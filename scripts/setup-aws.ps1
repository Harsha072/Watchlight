# PowerShell script to set up AWS SNS/SQS for Watchlight
# Run this script after configuring AWS CLI

Write-Host "Setting up AWS SNS/SQS for Watchlight..." -ForegroundColor Cyan

# Get AWS Account ID
Write-Host "`nGetting AWS Account ID..." -ForegroundColor Yellow
$accountId = aws sts get-caller-identity --query Account --output text
if (-not $accountId) {
    Write-Host "Error: AWS CLI not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}
Write-Host "Account ID: $accountId" -ForegroundColor Green

$region = "us-east-1"
$topicName = "observability-topic"

# Create SNS topic
Write-Host "`nCreating SNS topic: $topicName..." -ForegroundColor Yellow
$topicArn = aws sns create-topic --name $topicName --region $region --query 'TopicArn' --output text
if (-not $topicArn) {
    Write-Host "Error: Failed to create SNS topic" -ForegroundColor Red
    exit 1
}
Write-Host "Topic ARN: $topicArn" -ForegroundColor Green

# Create queues
$queues = @("metrics-queue", "logs-queue", "trace-queue", "ai-analyzer-queue", "notify-queue")
Write-Host "`nCreating SQS queues..." -ForegroundColor Yellow

foreach ($queue in $queues) {
    Write-Host "  Creating queue: $queue" -ForegroundColor Gray
    $queueUrl = aws sqs create-queue --queue-name $queue --region $region --query 'QueueUrl' --output text
    if ($queueUrl) {
        Write-Host "    ✓ Created: $queueUrl" -ForegroundColor Green
    } else {
        Write-Host "    ✗ Failed to create: $queue" -ForegroundColor Red
    }
}

# Subscribe queues to topic
Write-Host "`nSubscribing queues to SNS topic..." -ForegroundColor Yellow

foreach ($queue in $queues) {
    Write-Host "  Subscribing $queue..." -ForegroundColor Gray
    $subscriptionArn = aws sns subscribe `
        --topic-arn $topicArn `
        --protocol sqs `
        --notification-endpoint "arn:aws:sqs:${region}:${accountId}:${queue}" `
        --region $region `
        --query 'SubscriptionArn' `
        --output text
    
    if ($subscriptionArn) {
        Write-Host "    ✓ Subscribed" -ForegroundColor Green
    } else {
        Write-Host "    ✗ Failed to subscribe: $queue" -ForegroundColor Red
    }
}

# Output configuration
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "="*60 -ForegroundColor Cyan
Write-Host "`nAdd these to your .env file:" -ForegroundColor Yellow
Write-Host "`n# AWS Configuration" -ForegroundColor Gray
Write-Host "AWS_REGION=$region" -ForegroundColor White
Write-Host "AWS_ACCESS_KEY_ID=your_access_key_id" -ForegroundColor White
Write-Host "AWS_SECRET_ACCESS_KEY=your_secret_access_key" -ForegroundColor White
Write-Host "`n# SNS Topic ARN" -ForegroundColor Gray
Write-Host "OBSERVABILITY_TOPIC_ARN=$topicArn" -ForegroundColor White
Write-Host "`n# SQS Queue URLs" -ForegroundColor Gray
foreach ($queue in $queues) {
    $queueUrl = "https://sqs.${region}.amazonaws.com/${accountId}/${queue}"
    $envVar = $queue.ToUpper().Replace("-", "_") + "_QUEUE_URL"
    Write-Host "$envVar=$queueUrl" -ForegroundColor White
}

Write-Host "`nNote: Remove or comment out AWS_ENDPOINT in .env (it's only for LocalStack)" -ForegroundColor Yellow

