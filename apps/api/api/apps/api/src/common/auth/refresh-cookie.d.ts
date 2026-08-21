import type { Request, Response } from 'express';
/**
 * The refresh token as an HttpOnly cookie.
 *
 * It used to live in the web app's `localStorage`, which any XSS on any tenant
 * site could read. As a cookie the browser holds it and JavaScript cannot.
 *
 * `api.sckools.com` and every `*.sckools.com` school host share the registrable
 * domain, so a `Domain=.sckools.com` cookie is same-site: `SameSite=Lax` is
 * enough and no third-party-cookie rules apply.
 *
 * School and owner sessions get separate names on purpose — both are scoped to
 * the same parent domain, so one name would let an owner login clobber a school
 * login in the same browser.
 */
export declare const SCHOOL_REFRESH_COOKIE = "skoolos_rt";
export declare const OWNER_REFRESH_COOKIE = "skoolos_ort";
interface CookieEnv {
    PLATFORM_HOST: string;
    JWT_REFRESH_TTL: number;
    NODE_ENV?: string;
}
export declare function setRefreshCookie(res: Response, name: string, token: string, env: CookieEnv): void;
export declare function clearRefreshCookie(res: Response, name: string, env: CookieEnv): void;
/** Minimal cookie-header parse — avoids pulling cookie-parser into the ncc bundle. */
export declare function readCookie(req: Request, name: string): string | undefined;
/**
 * Cookie first, request body second. The body path is what keeps the migration
 * seamless: sessions created before this shipped still have their token in
 * localStorage, and the first refresh that arrives that way is answered with a
 * cookie — after which the client drops its copy.
 */
export declare function resolveRefreshToken(req: Request, name: string, bodyToken?: string): string | undefined;
export {};
//# sourceMappingURL=refresh-cookie.d.ts.map