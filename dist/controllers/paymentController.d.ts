import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
export declare const createPayment: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const handlePaymentSuccess: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
export declare const getPaymentHistory: (req: AuthRequest, res: Response) => Promise<Response<any, Record<string, any>>>;
//# sourceMappingURL=paymentController.d.ts.map