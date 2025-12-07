# PowerShell script to verify AWS SNS/SQS setup

Write-Host "Verifying AWS SNS/SQS Setup..." -ForegroundColor Cyan

# Get AWS Account ID
$accountId = aws sts get-caller-identity --query Account --output text
if (-not $accountId) {
    Write-Host "Error: AWS CLI not configured. Run 'aws configure' first." -ForegroundColor Red
    exit 1
}

$region = "us-east-1"
$topicName = "observability-topic"
$topicArn = "arn:aws:sns:${region}:${accountId}:${topicName}"
$queues = @("metrics-queue", "logs-queue", "trace-queue", "ai-analyzer-queue", "notify-queue")

Write-Host "`nAccount ID: $accountId" -ForegroundColor Green
Write-Host "Region: $region" -ForegroundColor Green

# Check SNS topic
Write-Host "`nChecking SNS topic..." -ForegroundColor Yellow
$topicExists = aws sns get-topic-attributes --topic-arn $topicArn --region $region 2>$null
if ($topicExists) {
    Write-Host "  ✓ Topic exists: $topicName" -ForegroundColor Green
} else {
    Write-Host "  ✗ Topic not found: $topicName" -ForegroundColor Red
}

# Check subscriptions
Write-Host "`nChecking subscriptions..." -ForegroundColor Yellow
$subscriptions = aws sns list-subscriptions-by-topic --topic-arn $topicArn --region $region --query 'Subscriptions[*].Endpoint' --output text
$subscriptionCount = ($subscriptions -split "`t").Count
Write-Host "  Found $subscriptionCount subscriptions" -ForegroundColor $(if ($subscriptionCount -eq 5) { "Green" } else { "Yellow" })

# Check queues
Write-Host "`nChecking SQS queues..." -ForegroundColor Yellow
$missingQueues = @()

foreach ($queue in $queues) {
    $queueUrl = "https://sqs.${region}.amazonaws.com/${accountId}/${queue}"
    $queueExists = aws sqs get-queue-attributes --queue-url $queueUrl --region $region 2>$null
    if ($queueExists) {
        Write-Host "  ✓ Queue exists: $queue" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Queue not found: $queue" -ForegroundColor Red
        $missingQueues += $queue
    }
}

# Summary
Write-Host "`n" + "="*60 -ForegroundColor Cyan
if ($missingQueues.Count -eq 0 -and $topicExists) {
    Write-Host "✓ Setup looks good!" -ForegroundColor Green
} else {
    Write-Host "⚠ Some issues found. Please check the errors above." -ForegroundColor Yellow
}
Write-Host "="*60 -ForegroundColor Cyan

