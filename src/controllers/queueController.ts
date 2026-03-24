import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getQueueJobForUser,
  getQueuePosition,
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
