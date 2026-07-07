import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  cancelQueueJobForUser,
  getQueueJobForUser,
  getQueuePosition,
  releaseUserDailyUsageReservation,
  updateAnalysis,
} from '../lib/supabase';
import { serializeAnalysis } from './analysisController';

const ESTIMATED_SECONDS_PER_JOB = 12;
const USER_VISIBLE_QUEUE_FAILURE_MESSAGE = 'Analysis failed';

export const getQueueStatus = async (req: AuthRequest, res: Response) => {
  try {
    const jobId = req.query.id as string;
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID is required' });
    }

    const job = await getQueueJobForUser(jobId, req.user!.id);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let position = 0;
    let estimatedWait = 0;

    if (job.status === 'queued') {
      position = await getQueuePosition(job.id);
      estimatedWait = position * ESTIMATED_SECONDS_PER_JOB;
    }

    return res.json({
      jobId: job.id,
      analysisId: job.analysisId,
      status: job.status,
      position,
      estimatedWait,
      result: job.status === 'completed' && job.result ? serializeAnalysis(job.result) : null,
      error: job.status === 'failed' ? USER_VISIBLE_QUEUE_FAILURE_MESSAGE : null,
      createdAt: job.createdAt,
    });
  } catch (error) {
    console.error('Queue status error:', error);
    return res.status(500).json({ error: 'Failed to fetch queue status' });
  }
};

export const cancelQueueJob = async (req: AuthRequest, res: Response) => {
  try {
    const jobId = req.body?.id as string;

    if (!jobId) {
      return res.status(400).json({ error: 'Job ID is required' });
    }

    const existingJob = await getQueueJobForUser(jobId, req.user!.id);
    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (existingJob.status === 'completed' || existingJob.status === 'failed' || existingJob.status === 'cancelled') {
      return res.status(409).json({ error: 'Job can no longer be cancelled' });
    }

    const cancelledJob = await cancelQueueJobForUser(jobId, req.user!.id);
    if (!cancelledJob) {
      return res.status(409).json({ error: 'Job could not be cancelled' });
    }

    await releaseUserDailyUsageReservation(req.user!.id).catch(() => {});

    if (existingJob.analysisId) {
      await updateAnalysis(existingJob.analysisId, {
        status: 'FAILED',
        progress: 100,
        currentStage: 'Analysis cancelled',
        errorMessage: 'Analysis cancelled',
      }).catch(() => {});
    }

    return res.json({ success: true, status: cancelledJob.status });
  } catch (error) {
    console.error('Cancel queue job error:', error);
    return res.status(500).json({ error: 'Failed to cancel analysis' });
  }
};
