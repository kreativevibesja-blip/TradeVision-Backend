import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from '../config';

export interface AnalysisJobData {
  analysisId: string;
  userId: string;
  imageUrl: string;
  filePath: string;
  pair: string;
  timeframe: string;
}

const redisUrl = new URL(config.redis.url);

export const analysisQueueConnection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.replace('/', '') || '0') : 0,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  ...(config.redis.tls ? { tls: {} } : {}),
};

export const analysisQueue = new Queue<AnalysisJobData, void, 'analyze-chart'>(config.analysis.queueName, {
  connection: analysisQueueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export async function enqueueAnalysisJob(data: AnalysisJobData) {
  return analysisQueue.add('analyze-chart', data, {
    jobId: data.analysisId,
  });
}