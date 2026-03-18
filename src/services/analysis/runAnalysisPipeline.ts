import fs from 'fs/promises';
import path from 'path';
import { analyzeChartVision } from '../imageProcessing/chartVision';
import { deriveMarketStructure } from '../structureEngine/marketStructure';
import { incrementUserDailyUsage, updateAnalysis } from '../../lib/supabase';
import { analyzeChartAI } from '../aiRouter';

interface RunAnalysisPipelineInput {
  analysisId: string;
  userId: string;
  pair: string;
  timeframe: string;
  filePath: string;
}

const getMimeType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  return 'image/jpeg';
};

export async function runAnalysisPipeline({ analysisId, userId, pair, timeframe, filePath }: RunAnalysisPipelineInput) {
  try {
    await updateAnalysis(analysisId, {
      status: 'PROCESSING',
      progress: 15,
      currentStage: 'Scanning chart...',
      errorMessage: null,
    });

    const layer1 = await analyzeChartVision(filePath, pair);

    await updateAnalysis(analysisId, {
      progress: 35,
      currentStage: 'Detecting market structure...',
      layer1Output: layer1,
      assetClass: layer1.assetClass,
    });

    const layer2 = deriveMarketStructure(layer1, pair);

    await updateAnalysis(analysisId, {
      progress: 60,
      currentStage: 'Mapping structure context...',
      layer2Output: layer2,
      structure: layer2.smcSignals,
      strategy: `${layer2.marketBias.toUpperCase()} ${layer2.tradeSetup.type.toUpperCase()} setup`,
    });

    await updateAnalysis(analysisId, {
      progress: 80,
      currentStage: 'Running AI analysis...',
    });

    const imageBuffer = await fs.readFile(filePath);
    const aiResult = await analyzeChartAI({
      userId,
      base64Image: imageBuffer.toString('base64'),
      mimeType: getMimeType(filePath),
      pair,
      timeframe,
      layer1,
      layer2,
    });

    const analysis = await updateAnalysis(analysisId, {
      status: 'COMPLETED',
      progress: 100,
      currentStage: 'Finalizing trade plan...',
      assetClass: layer1.assetClass,
      bias: aiResult.bias.toUpperCase(),
      entry: aiResult.entry,
      stopLoss: aiResult.stopLoss,
      tp1: aiResult.takeProfits[0] ?? null,
      tp2: aiResult.takeProfits[1] ?? null,
      takeProfits: aiResult.takeProfits,
      confidence: aiResult.confidence,
      explanation: aiResult.reasoning,
      analysisText: aiResult.reasoning,
      rawResponse: aiResult,
      waitConditions:
        aiResult.recommendation === 'enter now'
          ? 'Execution can be considered now if your own checklist is aligned.'
          : 'Wait for confirmation before executing this setup.',
      errorMessage: null,
    });

    await incrementUserDailyUsage(userId);

    return analysis;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed';

    await updateAnalysis(analysisId, {
      status: 'FAILED',
      progress: 100,
      currentStage: 'Analysis failed',
      errorMessage: message,
    }).catch((updateError) => {
      console.error('[analysis-pipeline] failed to persist failure state:', updateError);
    });

    throw error;
  }
}