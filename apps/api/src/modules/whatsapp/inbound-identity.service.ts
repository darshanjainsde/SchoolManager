import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { toE164 } from '../../common/notifications/whatsapp/phone';
import { PhoneProfilesService, type PhoneProfile } from '../auth';
import { isLeaveDesk } from '../management';

export type InboundNeed = { kind: 'LEAVE_DESK' } | { kind: 'SUBSTITUTE'; substitutionId: string };
export type ActorResult =
  | { ok: true; profile: PhoneProfile }
  | { ok: false; why: 'NO_PROFILE' | 'NOT_ALLOWED' | 'AMBIGUOUS' | 'INACTIVE' };

type Db = ReturnType<typeof getPlatformPrisma>;

/**
 * One LOGIN is one actor. PhoneProfile is keyed by `userId` (one login per
 * person per school); resolve() already merges by userId today, but an admin
 * with a Teacher row, or a family login per child, must never count as "two
 * people" here — that would turn one person into AMBIGUOUS. Keep the first
 * profile per userId; for LEAVE_DESK prefer the ADMIN / STAFF profile.
 */
function dedupeByUser(list: PhoneProfile[], need: InboundNeed): PhoneProfile[] {
  const deskKind = (p: PhoneProfile) => p.kind === 'ADMIN' || p.kind === 'STAFF';
  const ordered = need.kind === 'LEAVE_DESK' ? [...list.filter(deskKind), ...list.filter((p) => !deskKind(p))] : list;
  const out = new Map<string, PhoneProfile>();
  for (const p of ordered) if (!out.has(p.userId)) out.set(p.userId, p);
  return [...out.values()];
}

/**
 * WHO IS TAPPING — decided once, the same way login decides it.
 *
 * The login side already knew who is behind a phone (PhoneProfilesService);
 * the inbound side asked `user.findFirst` with no order, so two people on one
 * number meant whichever row Postgres returned first acted. Now the school
 * the PAYLOAD names (never the request) narrows the profiles, `need` filters
 * them, and exactly one eligible profile acts. None → NOT_ALLOWED, two or
 * more → AMBIGUOUS: nobody acts for a shared phone.
 */
@Injectable()
export class InboundIdentityService {
  constructor(private readonly profiles: PhoneProfilesService) {}

  async actorFor(phoneRaw: string, schoolId: string, need: InboundNeed): Promise<ActorResult> {
    const phone = toE164(phoneRaw);
    if (!phone) return { ok: false, why: 'NO_PROFILE' };
    const db = getPlatformPrisma();
    // resolve() is already scoped to the school; the filter is belt-and-braces
    // so a profile of another school can never act here, whatever resolve does.
    const profiles = (await this.profiles.resolve(phone, { schoolId })).filter((p) => p.schoolId === schoolId);
    if (profiles.length === 0) {
      const switchedOff = await db.user.count({ where: { schoolId, phone, isActive: false } });
      return { ok: false, why: switchedOff > 0 ? 'INACTIVE' : 'NO_PROFILE' };
    }
    const eligible = dedupeByUser(await this.eligible(db, schoolId, profiles, need), need);
    if (eligible.length === 1) return { ok: true, profile: eligible[0] };
    return { ok: false, why: eligible.length === 0 ? 'NOT_ALLOWED' : 'AMBIGUOUS' };
  }

  private async eligible(db: Db, schoolId: string, profiles: PhoneProfile[], need: InboundNeed): Promise<PhoneProfile[]> {
    if (need.kind === 'LEAVE_DESK') {
      const checks = await Promise.all(
        profiles.map(async (p) => ((p.kind === 'ADMIN' || p.kind === 'STAFF') && (await isLeaveDesk(db, schoolId, { userId: p.userId, role: p.role })) ? p : null)),
      );
      return checks.filter((p): p is PhoneProfile => p !== null);
    }
    const sub = await db.substitution.findFirst({ where: { id: need.substitutionId, schoolId }, select: { substituteTeacherId: true } });
    if (!sub?.substituteTeacherId) return [];
    const teacher = await db.teacher.findFirst({ where: { id: sub.substituteTeacherId, schoolId }, select: { userId: true } });
    return teacher?.userId ? profiles.filter((p) => p.userId === teacher.userId) : [];
  }
}
