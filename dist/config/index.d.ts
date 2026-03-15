export declare const config: {
    port: number;
    nodeEnv: string;
    database: {
        url: string;
    };
    supabase: {
        url: string;
        anonKey: string;
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    admin: {
        emails: string[];
    };
    openai: {
        apiKey: string;
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