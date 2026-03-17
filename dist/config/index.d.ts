export declare const config: {
    port: number;
    nodeEnv: string;
    supabase: {
        url: string;
        anonKey: string;
        serviceRoleKey: string;
        jwtSecret: string;
    };
    admin: {
        emails: string[];
    };
    openai: {
        apiKey: string;
        analysisModel: string;
    };
    redis: {
        url: string;
        tls: boolean;
    };
    analysis: {
        queueName: string;
        pollIntervalMs: number;
    };
    paypal: {
        clientId: string;
        clientSecret: string;
        mode: string;
        baseUrl: string;
    };
    frontend: {
        url: string;
        urls: string[];
        previewDomain: string;
    };
    upload: {
        dir: string;
        maxFileSize: number;
    };
    limits: {
        freeDaily: number;
        proDaily: number;
    };
};
//# sourceMappingURL=index.d.ts.map