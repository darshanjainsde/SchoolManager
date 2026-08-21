export declare class RegisterPushTokenDto {
    /** Expo push tokens look like `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]`. */
    token: string;
    platform: 'android' | 'ios';
}
/**
 * `POST /me/diary/:id/sign` — the signature in the margin of a red-ink remark
 * (Phase 5·3). Lives here, not in `management.dto.ts`, because it belongs to a
 * `/me` endpoint: a controller in this module importing a DTO out of another
 * module's internals is exactly what the module-boundary rule forbids (and
 * `pnpm preflight`'s dependency-cruiser step catches).
 */
export declare class SignDiaryEntryDto {
    signedName: string;
}
/**
 * How many seats a signed-in family is taking. Deliberately the ONLY thing this
 * request may say: who is registering comes from the JWT, and the event from
 * the path — there is no field here that could file the place as somebody else.
 */
export declare class RegisterForEventDto {
    quantity?: number;
}
//# sourceMappingURL=portal.dto.d.ts.map