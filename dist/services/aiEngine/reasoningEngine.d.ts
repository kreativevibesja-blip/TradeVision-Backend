import type { ChartVisionOutput } from '../imageProcessing/chartVision';
import type { MarketStructureOutput } from '../structureEngine/marketStructure';
export interface TradeReasoningOutput {
    bias: 'bullish' | 'bearish' | 'neutral';
    entry: number;
    stopLoss: number;
    tp1: number;
    tp2: number;
    confidence: number;
    explanation: string;
}
export declare function generateTradeReasoning(pair: string, timeframe: string, layer1: ChartVisionOutput, layer2: MarketStructureOutput): Promise<TradeReasoningOutput>;
//# sourceMappingURL=reasoningEngine.d.ts.map