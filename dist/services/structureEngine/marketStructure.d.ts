import type { ChartVisionOutput, DetectedZone } from '../imageProcessing/chartVision';
export interface TradeSetup {
    type: 'pullback' | 'breakout' | 'reversal' | 'range';
    entryZone: [number, number];
    stopLoss: number;
}
export interface MarketStructureOutput {
    marketBias: 'bullish' | 'bearish' | 'neutral';
    structure: string;
    liquidity: string;
    keyLevels: number[];
    tradeSetup: TradeSetup;
    volatilityRegime: string;
    smcSignals: {
        bos: string[];
        choch: string[];
        liquiditySweeps: string[];
        fairValueGaps: string[];
        supplyDemandZones: DetectedZone[];
    };
}
export declare function deriveMarketStructure(chartVision: ChartVisionOutput, pair: string): MarketStructureOutput;
//# sourceMappingURL=marketStructure.d.ts.map