import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LibraryTx } from '@library/db';
import { loadLibraryEnv } from '../../../config/env';
import type { AccessSigner } from './refresh.service';

/**
 * Accepting a already-logged-in Sckools user into the library.
 *
 * A child opening the library tab inside the Sckools app has already
 * authenticated once. Asking them to log in again to a second system, with a
 * second password, is how a portal goes unused — so the library takes the token
 * they already hold and issues its own.
 *
 * VERIFIED WITH A PUBLIC KEY, never a shared secret. Three reasons, and they
 * are the whole design:
 *
 *   - A shared HMAC secret would let anyone who compromised THIS service mint
 *     Sckools tokens. One blast radius becomes two, for a service whose entire
 *     point is that it is separable.
 *   - Calling Sckools to verify each login would put a hard runtime dependency
 *     on it — the library would go down when Sckools did, having deliberately
 *     been built to run standalone.
 *   - Public-key verification survives the merge unchanged. When the services
 *     join, this becomes dead code rather than a migration.
 *
 * The token this returns is an ORDINARY library token: same shape, same TTL,
 * same guards. Nothing downstream knows or cares how the session started, which
 * is what keeps the bridge from leaking into every other module.
 */
@Injectable()
export class SckoolsBridgeService {
  /**
   * The signer arrives by injection rather than by importing `signAccessToken`
   * from `auth.module`, which would be a circular import: the module registers
   * this service, so the service must not reach back into it. That cycle is
   * exactly the shape that has already cost this project an ncc cold-start
   * crash once, and `AccessSigner` (declared in refresh.service.ts) is the
   * existing seam for precisely this.
   *
   * `@Inject()` explicitly on both, never bare types — tsx does not reliably
   * emit `design:paramtypes`, and a silently-undefined dependency in an auth
   * path fails OPEN (trap 6).
   */
  constructor(
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject('ACCESS_SIGNER') private readonly signer: AccessSigner,
  ) {}

  async exchange(tx: LibraryTx, orgId: string, sckoolsToken: string): Promise<{ accessToken: string }> {
    const env = loadLibraryEnv();
    if (!env.SCKOOLS_JWT_PUBLIC_KEY) {
      // The library runs standalone and must keep working that way. A school
      // that has not linked the two systems is not misconfigured.
      throw new ServiceUnavailableException('This library is not linked to a Sckools account yet');
    }

    let claims: { sub?: string; iss?: string };
    try {
      claims = await this.jwt.verifyAsync(sckoolsToken, {
        publicKey: env.SCKOOLS_JWT_PUBLIC_KEY,
        algorithms: ['RS256'],
        issuer: env.SCKOOLS_JWT_ISSUER,
      });
    } catch {
      // Deliberately opaque: a caller must not learn whether the token was
      // expired, wrongly signed, or issued by somebody else.
      throw new UnauthorizedException('That sign-in could not be verified');
    }

    // `algorithms: ['RS256']` above is DEFENCE IN DEPTH, and the distinction
    // is worth stating precisely because it is easy to overclaim.
    //
    // The attack it guards is JWT algorithm confusion: a token declaring
    // `"alg": "HS256"` verified with the RSA PUBLIC key as an HMAC secret —
    // and a public key is, by definition, public, so anyone could mint one.
    //
    // Verified by removing the pin and re-running the forged-token test: it
    // still failed, because `jsonwebtoken` independently refuses an HMAC
    // algorithm when handed a PEM asymmetric key. So the library is what
    // currently stops it, and this line is the belt to that pair of braces —
    // it keeps the guarantee ours rather than a behaviour of a dependency that
    // could change in a major version.

    const externalRef = claims.sub;
    if (!externalRef) throw new UnauthorizedException('That sign-in could not be verified');

    // The join key. `Member.externalRef` has been in the schema since the first
    // migration precisely so this needs no schema change.
    const member = await tx.member.findFirst({
      where: { orgId, externalRef },
      include: { login: true },
    });
    if (!member) {
      // The person is a real Sckools user but has no library membership. Not an
      // auth failure — nobody has enrolled them yet.
      throw new UnauthorizedException('This person has no library membership');
    }
    if (member.status !== 'ACTIVE') {
      throw new UnauthorizedException('This library membership is not active');
    }
    if (!member.login) {
      throw new UnauthorizedException('This person has no library membership');
    }
    if (!member.login.active) {
      throw new UnauthorizedException('This library membership is not active');
    }

    return {
      accessToken: this.signer.signAccess({
        id: member.login.id,
        orgId: member.login.orgId,
        role: member.login.role,
        branchIds: member.login.branchIds,
      }),
    };
  }
}
