export declare class CreateLeadDto {
    name?: string;
    phone: string;
    school?: string;
    interest?: string;
    source: string;
}
export declare class SetLeadStatusDto {
    status: 'NEW' | 'CONTACTED' | 'CLOSED';
}
export declare class UpdateMarketingConfigDto {
    priceBasicUsd: number;
    priceBasicInr: number;
    priceStdUsd: number;
    priceStdInr: number;
    priceProUsd: number;
    priceProInr: number;
    contactEmail: string;
    contactPhone?: string;
}
export interface PublicMarketingConfig {
    prices: {
        basic: {
            usd: number;
            inr: number;
        };
        standard: {
            usd: number;
            inr: number;
        };
        pro: {
            usd: number;
            inr: number;
        };
    };
    contactEmail: string;
    contactPhone: string;
}
//# sourceMappingURL=marketing.dto.d.ts.map