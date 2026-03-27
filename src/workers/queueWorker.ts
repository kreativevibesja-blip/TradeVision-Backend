import {
  claimNextQueueJob,
  getQueueJobById,
  updateQueueJob,
  createAnalysis,
  updateAnalysis,
  getUserById,
  releaseUserDailyUsageReservation,
  type QueueJobRecord,
} from '../lib/supabase';
import { runAnalysisPipeline } from '../services/analysis/runAnalysisPipeline';
import { runLiveChartAnalysisPipeline } from '../services/analysis/runLiveChartAnalysisPipeline';
import { fetchMarketDataForLiveChart } from '../services/marketData';
import { inferAssetClass } from '../utils/volatilityDetector';
import { serializeAnalysis } from '../controllers/analysisController';

const POLL_INTERVAL_MS = 2_000;
const MAX_RETRIES = 1;
const MAX_CONCURRENT = 2;

let activeJobs = 0;
let workerTimer: ReturnType<typeof setInterval> | null = null;

async function processJob(job: QueueJobRecord) {
  activeJobs++;
  const input = job.inputData as Record<string, any>;

  try {
    console.log(`[queue-worker] processing job ${job.id} for user ${job.userId}`);

    const user = await getUserById(job.userId);
    if (!user) {
      throw new Error('User not found');
    }

    const analysisId = input.analysisId as string;

    // Create Analysis record if not already created
    await createAnalysis({
      id: analysisId,
      jobId: analysisId,
      userId: job.userId,
      imageUrl: input.imageUrl,
      pair: input.pair,
      timeframe: input.timeframe,
      assetClass: inferAssetClass(input.pair),
      status: 'PROCESSING',
      progress: 5,
      currentStage: 'Queue processing started...',
    }).catch(() => {
      // Analysis might already exist if retrying
    });

    // Link queue job to analysis
    await updateQueueJob(job.id, { analysisId });
    const isLiveChartJob = input.source === 'tradingview-live' || input.source === 'deriv-live';

    const analysis = isLiveChartJob
      ? await (async () => {
          const resolvedMarketData = input.source === 'deriv-live'
            ? {
                symbol: input.pair,
                timeframe: input.timeframe,
                candles: input.candles,
                currentPrice: input.candles[input.candles.length - 1].close,
              }
            : await fetchMarketDataForLiveChart(input.pair, input.timeframe);

          return runLiveChartAnalysisPipeline({
            analysisId,
            pair: resolvedMarketData.symbol,
            timeframe: input.timeframe,
            currentPrice: resolvedMarketData.currentPrice,
            candles: resolvedMarketData.candles,
          });
        })()
      : await runAnalysisPipeline({
          analysisId,
          userId: job.userId,
          pair: input.pair,
          timeframe: input.timeframe,
          subscription: user.subscription,
          currentPrice: input.currentPrice,
          chartMinPrice: input.chartMinPrice ?? null,
          chartMaxPrice: input.chartMaxPrice ?? null,
          imageUrl: input.imageUrl,
          base64Image: input.base64Image,
          mimeType: input.mimeType,
          secondaryChart: input.secondaryChart ?? null,
        });

    const latestJob = await getQueueJobById(job.id);
    if (latestJob?.status === 'cancelled') {
      await updateAnalysis(analysisId, {
        status: 'FAILED',
        progress: 100,
        currentStage: 'Analysis cancelled',
        errorMessage: 'Analysis cancelled',
      }).catch(() => {});
      console.log(`[queue-worker] job ${job.id} was cancelled before completion was persisted`);
      return;
    }

    await updateQueueJob(job.id, {
      status: 'completed',
      result: serializeAnalysis(analysis) as any,
      completedAt: new Date().toISOString(),
    });

    console.log(`[queue-worker] job ${job.id} completed`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Job processing failed';
    console.error(`[queue-worker] job ${job.id} failed:`, message);

    const latestJob = await getQueueJobById(job.id).catch(() => null);
    if (latestJob?.status === 'cancelled') {
      const analysisId = (job.inputData as any).analysisId;
      if (analysisId) {
        await updateAnalysis(analysisId, {
          status: 'FAILED',
          progress: 100,
          currentStage: 'Analysis cancelled',
          errorMessage: 'Analysis cancelled',
        }).catch(() => {});
      }
      return;
    }

    if (job.retryCount < MAX_RETRIES) {
      // Re-queue for retry
      await updateQueueJob(job.id, {
        status: 'queued',
        retryCount: job.retryCount + 1,
        startedAt: null,
        error: `Retry ${job.retryCount + 1}: ${message}`,
      });
      console.log(`[queue-worker] job ${job.id} re-queued for retry (attempt ${job.retryCount + 1})`);
    } else {
      await updateQueueJob(job.id, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });

      // Release the daily usage reservation on final failure
      await releaseUserDailyUsageReservation(job.userId).catch((err) => {
        console.error(`[queue-worker] failed to release usage for user ${job.userId}:`, err);
      });

      // Also mark the analysis as failed
      const analysisId = (job.inputData as any).analysisId;
      if (analysisId) {
        await updateAnalysis(analysisId, {
          status: 'FAILED',
          progress: 100,
          currentStage: 'Analysis failed',
          errorMessage: message,
        }).catch(() => {});
      }
    }
  } finally {
    activeJobs--;
  }
}

async function tick() {
  if (activeJobs >= MAX_CONCURRENT) {
    return;
  }

  try {
    const job = await claimNextQueueJob();
    if (!job) {
      return;
    }

    // Fire-and-forget to allow concurrent processing
    processJob(job).catch((err) => {
      console.error('[queue-worker] unhandled error in processJob:', err);
    });
  } catch (error) {
    console.error('[queue-worker] tick error:', error);
  }
}

export function startQueueWorker() {
  if (workerTimer) {
    return;
  }

  console.log(`[queue-worker] started (poll every ${POLL_INTERVAL_MS}ms, max ${MAX_CONCURRENT} concurrent)`);
  workerTimer = setInterval(tick, POLL_INTERVAL_MS);

  // Run first tick immediately
  tick();
}

export function stopQueueWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log('[queue-worker] stopped');
  }
}
