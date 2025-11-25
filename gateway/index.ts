import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root directory
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS for S3 deployment
// Allow requests from S3 bucket, CloudFront, and localhost for development
const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (like mobile apps, Postman, or same-origin requests)
    if (!origin) return callback(null, true);
    
    // List of allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.S3_BUCKET_URL,        // S3 bucket URL (e.g., https://your-bucket.s3.amazonaws.com)
      process.env.CLOUDFRONT_URL,        // CloudFront distribution URL
      process.env.FRONTEND_URL,         // Custom frontend URL
    ].filter(Boolean); // Remove undefined values
    
    // For S3/CloudFront deployment, allow all origins for demo purposes
    // In production, you can restrict this to specific domains
    // Allow if origin is in allowed list, localhost, or S3/CloudFront domain
    if (allowedOrigins.includes(origin) || 
        origin.includes('localhost') || 
        origin.includes('127.0.0.1') ||
        origin.includes('.s3.') ||
        origin.includes('.s3-website-') ||
        origin.includes('cloudfront.net')) {
      callback(null, true);
    } else {
      // For demo purposes, allow all origins
      // In production, you might want to be more strict
      callback(null, true);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'gateway' });
});

// Serve static files from public directory (for S3 deployment)
app.use(express.static(path.join(__dirname, 'public')));

// Import routes
import logsRoutes from './routes/logs';
import metricsRoutes from './routes/metrics';
import tracesRoutes from './routes/traces';
import aiAnalyzerRoutes from './routes/ai-analyzer';
import dashboardRoutes from './routes/dashboard';
import { initializeCloudWatch } from './services/cloudwatch';

app.use('/', logsRoutes);
app.use('/', metricsRoutes);
app.use('/', tracesRoutes);
app.use('/', aiAnalyzerRoutes);
app.use('/', dashboardRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Initialize CloudWatch logging
initializeCloudWatch().catch((err) => {
  console.warn('⚠️ CloudWatch initialization warning:', err.message);
});

app.listen(PORT, () => {
  console.log(`Gateway service running on port ${PORT}`);
});

