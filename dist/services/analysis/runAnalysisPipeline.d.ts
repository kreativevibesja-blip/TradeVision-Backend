interface RunAnalysisPipelineInput {
    analysisId: string;
    userId: string;
    pair: string;
    timeframe: string;
    filePath: string;
}
export declare function runAnalysisPipeline({ analysisId, userId, pair, timeframe, filePath }: RunAnalysisPipelineInput): Promise<import("../../lib/supabase").AnalysisRecord>;
export {};
//# sourceMappingURL=runAnalysisPipeline.d.ts.map