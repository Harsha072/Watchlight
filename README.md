# Watchlight - API Observability Mesh

A comprehensive microservices-based observability platform that aggregates metrics, logs, and traces from your APIs, analyzes them with AI, and provides intelligent alerts and insights.

## 🌐 Live Demo

**Try it now!** The platform is live and deployed on Render:

🔗 **[https://watchlight-gateway.onrender.com/](https://watchlight-gateway.onrender.com/)**

The live dashboard includes:
- Real-time metrics, logs, and traces visualization
- AI-powered anomaly detection
- Scenario testing capabilities (Normal, High Traffic, Error Spike, Slow Response, Anomaly Detection)
- Anomaly timeline view
- Interactive charts and analytics

## Project Overview

**Watchlight** is an API Observability Mesh that solves the critical problem of fragmented observability data across distributed systems. Instead of juggling multiple monitoring tools and dashboards, developers get a unified platform that automatically collects, analyzes, and alerts on API behavior using AI-powered insights.

### Problem It Solves

Modern applications generate massive amounts of observability data (metrics, logs, traces) that are often scattered across different systems. Developers struggle to:
- Correlate metrics, logs, and traces across services
- Identify anomalies and performance issues quickly
- Get actionable insights from observability data
- Set up and maintain multiple monitoring tools

Watchlight solves this by providing a single, intelligent observability mesh that automatically processes, analyzes, and alerts on your API data.

### Tech Stack

- **Backend**: Node.js + TypeScript
- **Message Queue**: AWS SNS/SQS (LocalStack for local development)
- **Database**: PostgreSQL
- **Cache**: Redis
- **AI Analysis**: Groq API + Anthropic Claude API
- **Notifications**: Slack Webhooks + SMTP Email
- **Frontend**: Next.js + React + TypeScript
- **Infrastructure**: Docker Compose

## Architecture

```
Client / UI
    |
    v
Gateway Service
    |
    v
SNS Topic ---> SQS Queues
         |          |        |
         v          v        v
  Metrics Service Logs Service Trace Service
         \           |        /
          \          v       /
           \-----> AI Analyzer -----> Notify Service
                     |
                     v
                 Postgres / Redis
```

### Architecture Flow

1. **Gateway Service**: Entry point that receives observability data from clients
2. **SNS Topic**: Publishes messages to multiple SQS queues
3. **Processing Services**: Three specialized services consume from their respective queues:
   - **Metrics Service**: Processes performance metrics
   - **Logs Service**: Processes application logs
   - **Trace Service**: Processes distributed tracing data
4. **AI Analyzer**: Aggregates data from all three services and uses AI (Groq/Claude) to:
   - Detect anomalies
   - Identify performance bottlenecks
   - Generate insights
5. **Notify Service**: Sends alerts via Slack or Email when issues are detected
6. **Storage**: PostgreSQL for persistent storage, Redis for caching

## Folder Structure

```
/api-observability-mesh
  /gateway
    /routes          # Express route handlers
    /controllers     # Request controllers
    /services        # Business logic
    index.ts         # Express server entry point
    package.json
    tsconfig.json
  
  /metrics-service
    /services        # Metrics processing logic
    index.ts         # SQS consumer
    package.json
    tsconfig.json
  
  /logs-service
    /services        # Logs processing logic
    index.ts         # SQS consumer
    package.json
    tsconfig.json
  
  /trace-service
    /services        # Trace processing logic
    index.ts         # SQS consumer
    package.json
    tsconfig.json
  
  /ai-analyzer
    /services        # AI analysis logic
    index.ts         # AI analyzer service
    package.json
    tsconfig.json
  
  /notify-service
    /services        # Notification logic
    index.ts         # Notification service
    package.json
    tsconfig.json
  
  /infra
    docker-compose.yml    # Local development infrastructure
    env.example           # Environment variables template
    localstack-setup.sh   # SNS/SQS setup script (Linux/Mac/Git Bash)
    localstack-setup.js   # SNS/SQS setup script (Cross-platform Node.js)
    localstack-setup.ps1  # SNS/SQS setup script (Windows PowerShell)
  
  /frontend
    /pages           # Next.js pages
    /components      # React components
    /styles          # CSS styles
    package.json
    tsconfig.json
    next.config.js
  
  docker-compose.yml  # Main docker-compose for services
  README.md
```

## Local Development Instructions

### Prerequisites

- Node.js 18+ and npm
- Docker and Docker Compose
- AWS CLI (for LocalStack setup)

### Setup Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd Watchlight/api-observability-mesh
   ```

2. **Install dependencies**
   
   For each service, install dependencies:
   ```bash
   cd gateway && npm install && cd ..
   cd metrics-service && npm install && cd ..
   cd logs-service && npm install && cd ..
   cd trace-service && npm install && cd ..
   cd ai-analyzer && npm install && cd ..
   cd notify-service && npm install && cd ..
   cd frontend && npm install && cd ..
   ```

3. **Set up environment variables**
   
   Copy the example environment file:
   ```bash
   cp infra/env.example .env
   ```
   
   Edit `.env` and fill in your API keys and configuration:
   - `GROQ_API_KEY`: Your Groq API key
   - `ANTHROPIC_API_KEY`: Your Anthropic Claude API key
   - `SLACK_WEBHOOK_URL`: Your Slack webhook URL (optional)
   - `SMTP_*`: Email configuration (optional)

4. **Start infrastructure services**
   ```bash
   docker-compose up -d
   ```
   
   This starts:
   - PostgreSQL on port 5432
   - Redis on port 6379
   - LocalStack on port 4566

5. **Set up LocalStack SNS/SQS**
   
   **Option A: Node.js (Cross-platform - Recommended)**
   ```bash
   node infra/localstack-setup.js
   ```
   
   **Option B: PowerShell (Windows)**
   ```powershell
   .\infra\localstack-setup.ps1
   ```
   
   **Option C: Bash (Linux/Mac/Git Bash)**
   ```bash
   chmod +x infra/localstack-setup.sh
   ./infra/localstack-setup.sh
   ```
   
   This creates:
   - SNS topic: `observability-topic`
   - SQS queues: `metrics-queue`, `logs-queue`, `trace-queue`, `ai-analyzer-queue`, `notify-queue`

6. **Start services**
   
   **Option A: Start all services at once (Recommended)**
   
   Using npm script (single terminal, all output):
   ```bash
   npm install  # Install concurrently if not already installed
   npm run start:services
   ```
   
   Using Node.js script (single terminal):
   ```bash
   npm run start:all
   ```
   
   Using PowerShell (Windows - separate windows):
   ```powershell
   .\start-all.ps1
   ```
   
   Using Batch file (Windows - separate windows):
   ```cmd
   start-all.bat
   ```
   
   **Option B: Start services individually**
   
   In separate terminal windows:
   ```bash
   # Terminal 1: Gateway
   cd gateway && npm run dev
   
   # Terminal 2: Metrics Service
   cd metrics-service && npm run dev
   
   # Terminal 3: Logs Service
   cd logs-service && npm run dev
   
   # Terminal 4: Trace Service
   cd trace-service && npm run dev
   
   # Terminal 5: AI Analyzer
   cd ai-analyzer && npm run dev
   
   # Terminal 6: Notify Service
   cd notify-service && npm run dev
   
   # Terminal 7: Frontend
   cd frontend && npm run dev
   ```
   
   **Stop all services:**
   ```bash
   npm run stop:all
   # Or on Windows PowerShell:
   .\stop-all.ps1
   ```

7. **Access the application locally**
   - **Local Frontend**: http://localhost:3000
   - **Local Gateway**: http://localhost:3000 (or configured port)
   - **LocalStack**: http://localhost:4566

## Environment Variables

### Required Variables

- `DATABASE_URL`: PostgreSQL connection string
  - Format: `postgresql://user:password@host:port/database`
  - Example: `postgresql://watchlight:watchlight123@localhost:5432/watchlight`

- `REDIS_URL`: Redis connection string
  - Format: `redis://host:port`
  - Example: `redis://localhost:6379`

- `GROQ_API_KEY`: Your Groq API key for AI analysis
  - Get from: https://console.groq.com/

- `ANTHROPIC_API_KEY`: Your Anthropic Claude API key
  - Get from: https://console.anthropic.com/

- `AWS_REGION`: AWS region for SNS/SQS
  - Default: `us-east-1`

### Optional Variables

- `AWS_ENDPOINT`: LocalStack endpoint (for local development)
  - Default: `http://localhost:4566`

- `SLACK_WEBHOOK_URL`: Slack webhook for notifications
  - Format: `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`

- `SMTP_HOST`: SMTP server for email notifications
  - Example: `smtp.gmail.com`

- `SMTP_PORT`: SMTP port
  - Default: `587`

- `SMTP_USER`: SMTP username/email

- `SMTP_PASS`: SMTP password

### Queue URLs

These are automatically set up by the LocalStack setup script:
- `METRICS_QUEUE_URL`
- `LOGS_QUEUE_URL`
- `TRACE_QUEUE_URL`
- `AI_ANALYZER_QUEUE_URL`
- `NOTIFY_QUEUE_URL`

## Future Steps


## 🚀 Deployment

### Production Deployment

Watchlight is currently deployed and running on **Render.com**:

- **Live Dashboard**: [https://watchlight-gateway.onrender.com/](https://watchlight-gateway.onrender.com/)
- **Status**: Production Ready ✅
- **All Services**: Deployed as web services with health check endpoints

### Deployment Architecture

All services have been converted to web services with `/health` endpoints for Render's health checks:
- Gateway Service (serves frontend + API)
- Logs Service
- Metrics Service
- Trace Service
- AI Analyzer Service
- Notify Service
- Cron Aggregator Service
- Auto-Anomaly Detector Service

Each service:
- Has a health check endpoint at `/health`
- Uses environment variables for configuration
- Connects to PostgreSQL (Render PostgreSQL) and Redis (Upstash)
- Communicates via AWS SNS/SQS

## Development Notes

- All services use TypeScript with strict mode enabled
- Services communicate via AWS SNS/SQS for decoupling
- LocalStack is used for local AWS service emulation
- Each service is independently deployable
- The frontend is served as static files from the Gateway service


## License

ISC

