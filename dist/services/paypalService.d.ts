interface PayPalOrder {
    id: string;
    status: string;
    links: {
        href: string;
        rel: string;
        method: string;
    }[];
}
export declare function createOrder(amount: string, planName: string): Promise<PayPalOrder>;
export declare function captureOrder(orderId: string): Promise<any>;
export {};
//# sourceMappingURL=paypalService.d.ts.map