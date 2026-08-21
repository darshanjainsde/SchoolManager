/**
 * Argon2id with default parameters (timeCost=3, memoryCost=64MB, parallelism=1)
 * — meets OWASP 2023 recommendations for interactive logins.
 */
export declare class PasswordService {
    hash(plain: string): Promise<string>;
    verify(hash: string, plain: string): Promise<boolean>;
}
//# sourceMappingURL=password.service.d.ts.map