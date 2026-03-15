import { Request, Response } from 'express';
export declare const getDashboardStats: (_req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getUsers: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const updateUser: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getAnalysisLogs: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getPayments: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getAnalytics: (_req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getPricingPlans: (_req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const updatePricingPlan: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getSystemSettings: (_req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const updateSystemSetting: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getAnnouncements: (_req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const createAnnouncement: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const updateAnnouncement: (req: Request, res: Response) => Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=adminController.d.ts.map