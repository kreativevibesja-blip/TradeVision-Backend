export declare const supabase: import("@supabase/supabase-js").SupabaseClient<any, "public", "public", any, any>;
export type SubscriptionTier = 'FREE' | 'PRO';
export type UserRole = 'USER' | 'ADMIN';
export type PaymentStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUNDED';
export type AnalysisStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export interface UserRecord {
    id: string;
    supabaseId: string | null;
    email: string;
    password: string | null;
    name: string | null;
    role: UserRole;
    subscription: SubscriptionTier;
    dailyUsage: number;
    lastUsageReset: string;
    banned: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface AnalysisRecord {
    id: string;
    jobId: string;
    userId: string;
    imageUrl: string;
    pair: string;
    timeframe: string;
    assetClass: string | null;
    status: AnalysisStatus;
    progress: number;
    currentStage: string | null;
    bias: string | null;
    entry: number | null;
    stopLoss: number | null;
    tp1: number | null;
    tp2: number | null;
    takeProfits: unknown;
    confidence: number | null;
    explanation: string | null;
    analysisText: string | null;
    strategy: string | null;
    structure: unknown;
    waitConditions: string | null;
    rawResponse: unknown;
    layer1Output: unknown;
    layer2Output: unknown;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface PaymentRecord {
    id: string;
    userId: string;
    paypalOrderId: string;
    amount: number;
    currency: string;
    status: PaymentStatus;
    plan: SubscriptionTier;
    createdAt: string;
    updatedAt: string;
}
export interface PricingPlanRecord {
    id: string;
    name: string;
    tier: SubscriptionTier;
    price: number;
    features: unknown;
    dailyLimit: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export interface SystemSettingRecord {
    id: string;
    key: string;
    value: any;
    updatedAt: string;
}
export interface AnnouncementRecord {
    id: string;
    title: string;
    content: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}
export declare const getUserByEmail: (email: string) => Promise<UserRecord | null>;
export declare const getUserById: (id: string) => Promise<UserRecord | null>;
export declare const createUser: (values: Partial<UserRecord> & Pick<UserRecord, "email" | "role">) => Promise<UserRecord>;
export declare const updateUser: (id: string, values: Partial<UserRecord>) => Promise<UserRecord>;
export declare const listUsersPage: (search: string | undefined, page: number, limit: number) => Promise<{
    users: {
        _count: {
            analyses: number;
            payments: number;
        };
        id?: string | undefined;
        supabaseId?: string | null | undefined;
        email?: string | undefined;
        password?: string | null | undefined;
        name?: string | null | undefined;
        role?: UserRole | undefined;
        subscription?: SubscriptionTier | undefined;
        dailyUsage?: number | undefined;
        lastUsageReset?: string | undefined;
        banned?: boolean | undefined;
        createdAt?: string | undefined;
        updatedAt?: string | undefined;
    }[];
    total: number;
}>;
export declare const countUsers: (subscription?: SubscriptionTier) => Promise<number>;
export declare const incrementUserDailyUsage: (id: string) => Promise<UserRecord>;
export declare const createAnalysis: (values: Partial<AnalysisRecord> & Pick<AnalysisRecord, "id" | "jobId" | "userId" | "imageUrl" | "pair" | "timeframe">) => Promise<AnalysisRecord>;
export declare const updateAnalysis: (id: string, values: Partial<AnalysisRecord>) => Promise<AnalysisRecord>;
export declare const getAnalysisByJobIdForUser: (jobId: string, userId: string) => Promise<AnalysisRecord | null>;
export declare const getAnalysisByIdForUser: (id: string, userId: string) => Promise<AnalysisRecord | null>;
export declare const listAnalysesForUser: (userId: string, page: number, limit: number) => Promise<{
    analyses: AnalysisRecord[];
    total: number;
}>;
export declare const countAnalyses: () => Promise<number>;
export declare const listAllAnalysesPage: (page: number, limit: number) => Promise<{
    analyses: {
        user: {
            email: string | undefined;
            name: string | null | undefined;
        } | null;
        id: string;
        jobId: string;
        userId: string;
        imageUrl: string;
        pair: string;
        timeframe: string;
        assetClass: string | null;
        status: AnalysisStatus;
        progress: number;
        currentStage: string | null;
        bias: string | null;
        entry: number | null;
        stopLoss: number | null;
        tp1: number | null;
        tp2: number | null;
        takeProfits: unknown;
        confidence: number | null;
        explanation: string | null;
        analysisText: string | null;
        strategy: string | null;
        structure: unknown;
        waitConditions: string | null;
        rawResponse: unknown;
        layer1Output: unknown;
        layer2Output: unknown;
        errorMessage: string | null;
        createdAt: string;
        updatedAt: string;
    }[];
    total: number;
}>;
export declare const getPricingPlanByTier: (tier: SubscriptionTier) => Promise<PricingPlanRecord | null>;
export declare const listPricingPlans: () => Promise<PricingPlanRecord[]>;
export declare const updatePricingPlan: (id: string, values: Partial<PricingPlanRecord>) => Promise<PricingPlanRecord>;
export declare const createPaymentRecord: (values: Partial<PaymentRecord> & Pick<PaymentRecord, "userId" | "paypalOrderId" | "amount" | "status" | "plan">) => Promise<PaymentRecord>;
export declare const updatePaymentByOrderId: (paypalOrderId: string, values: Partial<PaymentRecord>) => Promise<PaymentRecord>;
export declare const listPaymentsForUser: () => Promise<PaymentRecord[]>;
export declare const listPaymentsForUserId: (userId: string) => Promise<PaymentRecord[]>;
export declare const listAllPaymentsPage: (page: number, limit: number) => Promise<{
    payments: {
        user: {
            email: string | undefined;
            name: string | null | undefined;
        } | null;
        id: string;
        userId: string;
        paypalOrderId: string;
        amount: number;
        currency: string;
        status: PaymentStatus;
        plan: SubscriptionTier;
        createdAt: string;
        updatedAt: string;
    }[];
    total: number;
}>;
export declare const getCompletedRevenue: () => Promise<number>;
export declare const listSystemSettings: () => Promise<SystemSettingRecord[]>;
export declare const upsertSystemSetting: (key: string, value: any) => Promise<SystemSettingRecord>;
export declare const listAnnouncements: () => Promise<AnnouncementRecord[]>;
export declare const createAnnouncementRecord: (values: Pick<AnnouncementRecord, "title" | "content">) => Promise<AnnouncementRecord>;
export declare const updateAnnouncementRecord: (id: string, values: Partial<AnnouncementRecord>) => Promise<AnnouncementRecord>;
export declare const getAnalyticsBuckets: (fromIso: string) => Promise<{
    userGrowth: {
        createdAt: string;
        _count: number;
    }[];
    analysesPerDay: {
        createdAt: string;
        _count: number;
    }[];
    revenueData: {
        createdAt: string;
        _sum: {
            amount: number;
        };
    }[];
}>;
//# sourceMappingURL=supabase.d.ts.map