import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare const analyzeChart: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getAnalyses: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getAnalysisById: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=analysisController.d.ts.map