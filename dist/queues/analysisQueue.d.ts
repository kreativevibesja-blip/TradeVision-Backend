import { Queue, type ConnectionOptions } from 'bullmq';
export interface AnalysisJobData {
    analysisId: string;
    userId: string;
    imageUrl: string;
    filePath: string;
    pair: string;
    timeframe: string;
}
export declare const analysisQueueConnection: ConnectionOptions;
export declare const analysisQueue: Queue<AnalysisJobData, void, "analyze-chart", AnalysisJobData, void, "analyze-chart">;
export declare function enqueueAnalysisJob(data: AnalysisJobData): Promise<import("bullmq").Job<AnalysisJobData, void, "analyze-chart">>;
//# sourceMappingURL=analysisQueue.d.ts.map