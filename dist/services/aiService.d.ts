export interface ChartAnalysis {
    marketCondition: string;
    bias: string;
    entry: string;
    stopLoss: string;
    takeProfits: string[];
    confidence: number;
    analysisText: string;
    strategy: string;
    structure: {
        bos: string[];
        choch: string[];
        liquidityZones: string[];
        supportResistance: string[];
    };
    waitConditions: string;
}
export declare function analyzeChart(imagePath: string, pair: string, timeframe: string): Promise<ChartAnalysis>;
//# sourceMappingURL=aiService.d.ts.map