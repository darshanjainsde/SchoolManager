import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  LeaveApplication,
  LeaveStatusValue,
  LeaveTypeValue,
  RegisterChangeRow,
} from '@skoolos/types';
import { LEAVE_TYPES } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { Card, Empty, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font, type ColorPalette } from '@/theme/tokens';

const LEAVE_TYPE_LABEL: Record<LeaveTypeValue, string> = {
  SICK: 'Sick leave',
  CASUAL: 'Casual leave',
  EARNED: 'Earned leave',
  UNPAID: 'Unpaid leave',
  OTHER: 'Other',
};

type PillTone = 'green' | 'red' | 'amber' | 'indigo' | 'neutral';

const LEAVE_STATUS_TONE: Record<LeaveStatusValue, PillTone> = {
  PENDING: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'neutral',
};

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/** Device-local read is irrelevant here — this is an absolute epoch compare
 * against `Date.now()`, so it is correct regardless of timezone. Mirrors
 * `isUnexpired` in `(staff)/attendance.tsx` (inverted). */
function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && new Date(expiresAt).getTime() < Date.now();
}

/**
 * A `YYYY-MM-DD` or UTC-midnight-ISO calendar date, read in UTC so it can
 * never roll backward/forward a day for a device west/east of UTC — mirrors
 * `holidayDateParts` in `lib/portal.ts` and `LeaveService.toRow`'s own
 * `startDate.toISOString()`.
 */
function formatDateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** A real timestamp (unlike the calendar dates above) — read in the
 * device's own local time, since `expiresAt` genuinely means a moment on
 * this device's clock. */
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

type RequestItem =
  | {
      kind: 'leave';
      id: string;
      title: string;
      detail: string;
      reason: string | null;
      status: LeaveStatusValue;
      createdAt: string;
      cancellable: boolean;
    }
  | {
      kind: 'register';
      id: string;
      title: string;
      detail: string;
      reason: string;
      status: RegisterChangeRow['status'];
      createdAt: string;
      expiresAt: string | null;
    };

function toLeaveItem(a: LeaveApplication): RequestItem {
  return {
    kind: 'leave',
    id: a.id,
    title: LEAVE_TYPE_LABEL[a.type] ?? a.type,
    detail: `${formatDateOnly(a.startDate)} – ${formatDateOnly(a.endDate)}`,
    reason: a.reason,
    status: a.status,
    createdAt: a.createdAt,
    cancellable: a.status === 'PENDING' || a.status === 'APPROVED',
  };
}

function toRegisterItem(r: RegisterChangeRow): RequestItem {
  return {
    kind: 'register',
    id: r.id,
    title: r.className,
    detail: formatDateOnly(r.date),
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

/**
 * Approval only ever means "unlocked until `expiresAt`" (see
 * `RegisterChangeService.review`'s `endOfIstDay`) — an APPROVED row whose
 * window has already passed must read as expired, not as an open unlock, or
 * a teacher will believe they still have time to make the correction.
 * Mirrors `apps/web/components/teacher/RequestList.tsx`'s
 * `registerStatusDisplay` so the two clients never disagree.
 */
function registerStatusDisplay(item: Extract<RequestItem, { kind: 'register' }>): {
  label: string;
  tone: PillTone;
} {
  if (item.status === 'APPROVED') {
    return isExpired(item.expiresAt) ? { label: 'Expired', tone: 'red' } : { label: 'Approved', tone: 'green' };
  }
  if (item.status === 'PENDING') return { label: 'Pending', tone: 'amber' };
  return { label: 'Rejected', tone: 'red' };
}

function chipStyle(tokens: { color: ColorPalette }, on: boolean) {
  return {
    borderWidth: 1.5,
    borderColor: on ? tokens.color.indigo : tokens.color.line,
    backgroundColor: on ? tokens.color.indigo50 : tokens.color.surface,
    borderRadius: 11,
    paddingVertical: 9,
    paddingHorizontal: 13,
  };
}

export default function Requests() {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
  };
  const labelStyle = { fontSize: 11.5, fontWeight: '700' as const, color: tokens.color.sub };
  // ── Queue: two independent fetches, each with its own settled state — a
  // failure on one side must never blank out data that already loaded on
  // the other (see the partial-failure requirement in the task brief).
  const [leaveData, setLeaveData] = useState<LeaveApplication[] | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const [leaveLoading, setLeaveLoading] = useState(true);

  const [registerData, setRegisterData] = useState<RegisterChangeRow[] | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerLoading, setRegisterLoading] = useState(true);

  const fetchLeave = useCallback(() => {
    setLeaveLoading(true);
    setLeaveError(null);
    return api
      .request<LeaveApplication[]>('/manage/leave/mine')
      .then((data) => setLeaveData(data))
      .catch((e: unknown) => setLeaveError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => setLeaveLoading(false));
  }, []);

  const fetchRegister = useCallback(() => {
    setRegisterLoading(true);
    setRegisterError(null);
    return api
      .request<RegisterChangeRow[]>('/manage/register-changes/mine')
      .then((data) => setRegisterData(data))
      .catch((e: unknown) => setRegisterError(e instanceof ApiError ? e.message : 'Something went wrong.'))
      .finally(() => setRegisterLoading(false));
  }, []);

  const fetchAll = useCallback(() => {
    void fetchLeave();
    void fetchRegister();
  }, [fetchLeave, fetchRegister]);

  useFocusEffect(useCallback(() => fetchAll(), [fetchAll]));

  const queueLoading = leaveLoading || registerLoading;
  // Settled and at least one side actually has data — the difference
  // between "nothing loaded yet" (don't even offer an empty list, that
  // would read as "you have zero requests" when really both calls failed)
  // and "one side loaded, the other didn't" (show what did load, next to
  // the failure, rather than silently rendering a half-list).
  const anyData = leaveData !== null || registerData !== null;
  const errorMessages = [...new Set([leaveError, registerError].filter((m): m is string => !!m))];

  const items: RequestItem[] = [
    ...(leaveData ?? []).map(toLeaveItem),
    ...(registerData ?? []).map(toRegisterItem),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

  // ── Cancel-leave ─────────────────────────────────────────────────────────
  // A ref, not just the `cancellingId` state, guards the actual network
  // call: two synchronous `onPress` invocations (a double-tap on the Alert's
  // confirm button, or a test simulating one) both read `cancellingId` as
  // whatever it was BEFORE either state update flushes, so state alone lets
  // both through. The ref is read-and-set synchronously, so only the first
  // wins.
  const cancellingRef = useRef<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelSuccess, setCancelSuccess] = useState(false);

  async function doCancel(id: string) {
    if (cancellingRef.current) return;
    cancellingRef.current = id;
    setCancellingId(id);
    setCancelError(null);
    setCancelSuccess(false);
    try {
      await api.request(`/manage/leave/${id}/cancel`, { method: 'POST' });
      setCancelSuccess(true);
      fetchAll();
    } catch (e) {
      setCancelError(e instanceof ApiError ? e.message : 'Could not cancel — try again.');
    } finally {
      cancellingRef.current = null;
      setCancellingId(null);
    }
  }

  function confirmCancel(id: string) {
    if (cancellingRef.current) return;
    Alert.alert('Cancel this leave?', 'Your classes and attendance for the cancelled dates will be restored.', [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, cancel leave', style: 'destructive', onPress: () => void doCancel(id) },
    ]);
  }

  // ── Apply for leave ──────────────────────────────────────────────────────
  const [type, setType] = useState<LeaveTypeValue>('SICK');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState('');
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState(false);

  const dateOrderInvalid = endDate < startDate;
  const canApply = !dateOrderInvalid && !applySubmitting;

  async function submitApply() {
    if (!canApply) return;
    setApplySubmitting(true);
    setApplyError(null);
    setApplySuccess(false);
    try {
      const trimmed = reason.trim();
      await api.request<LeaveApplication>('/manage/leave', {
        method: 'POST',
        body: { type, startDate, endDate, reason: trimmed || undefined },
      });
      setType('SICK');
      setStartDate(todayISO());
      setEndDate(todayISO());
      setReason('');
      setApplySuccess(true);
      fetchAll();
    } catch (e) {
      setApplyError(e instanceof ApiError ? e.message : 'Could not submit — try again.');
    } finally {
      setApplySubmitting(false);
    }
  }

  return (
    <Screen>
      <SectionTitle title="Requests" />
      <Text style={{ fontSize: 11, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Leave applications and register-change requests, in one place.
      </Text>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>Apply for leave</Text>

        <View>
          <Text style={[labelStyle, { marginBottom: 6 }]}>Type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {LEAVE_TYPES.map((t) => {
              const on = type === t;
              return (
                <Pressable key={t} testID={`apply-type-${t}`} onPress={() => setType(t)} style={chipStyle(tokens, on)}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: on ? tokens.color.indigo : tokens.color.sub }}>
                    {on ? `✓ ${LEAVE_TYPE_LABEL[t]}` : LEAVE_TYPE_LABEL[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={labelStyle}>From</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable testID="apply-from-prev" onPress={() => setStartDate((d) => shiftISO(d, -1))}>
              <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>‹</Text>
            </Pressable>
            <Text testID="apply-from-date" style={{ fontSize: 12.5, color: tokens.color.ink, minWidth: 84, textAlign: 'center' }}>
              {startDate}
            </Text>
            <Pressable testID="apply-from-next" onPress={() => setStartDate((d) => shiftISO(d, 1))}>
              <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>›</Text>
            </Pressable>
          </View>
        </View>

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={labelStyle}>To</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Pressable testID="apply-to-prev" onPress={() => setEndDate((d) => shiftISO(d, -1))}>
              <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>‹</Text>
            </Pressable>
            <Text testID="apply-to-date" style={{ fontSize: 12.5, color: tokens.color.ink, minWidth: 84, textAlign: 'center' }}>
              {endDate}
            </Text>
            <Pressable testID="apply-to-next" onPress={() => setEndDate((d) => shiftISO(d, 1))}>
              <Text style={{ color: tokens.color.indigo, fontWeight: '700' }}>›</Text>
            </Pressable>
          </View>
        </View>

        {dateOrderInvalid && (
          <Text testID="apply-date-order-error" style={{ color: tokens.color.red, fontSize: 12 }}>
            The end date must be on or after the start date.
          </Text>
        )}

        <View>
          <Text style={[labelStyle, { marginBottom: 6 }]}>Reason (optional)</Text>
          <TextInput
            testID="apply-reason"
            value={reason}
            onChangeText={setReason}
            placeholder="A short note for your admin"
            placeholderTextColor={tokens.color.sub}
            editable={!applySubmitting}
            multiline
            style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
          />
        </View>

        {applyError && (
          <Text testID="apply-error" style={{ color: tokens.color.red, fontSize: 12.5 }}>
            {applyError}
          </Text>
        )}

        <Pressable
          testID="apply-submit"
          disabled={!canApply}
          onPress={submitApply}
          style={{
            backgroundColor: tokens.color.indigo,
            borderRadius: 13,
            padding: 11,
            alignSelf: 'flex-start',
            opacity: canApply ? 1 : 0.6,
          }}
        >
          <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13 }}>
            {applySubmitting ? 'Submitting…' : 'Submit request'}
          </Text>
        </Pressable>

        {applySuccess && (
          <Toast kind="success" testID="apply-success" message="Leave request submitted — your admin will review it." />
        )}
      </Card>

      <Card style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: tokens.color.ink }}>My requests</Text>
          <Text style={{ fontSize: 11, color: tokens.color.sub }}>{items.length} total</Text>
        </View>
      </Card>

      {cancelError && (
        <Card>
          <Text testID="cancel-error" style={{ color: tokens.color.red }}>
            {cancelError}
          </Text>
        </Card>
      )}
      {cancelSuccess && (
        <Toast kind="success" testID="cancel-success" message="Leave cancelled — your classes and attendance have been restored." />
      )}

      {queueLoading ? (
        <LoadingRows label="Loading your requests…" rows={3} />
      ) : (
        <>
          {errorMessages.map((msg) => (
            <Card key={msg}>
              <Text testID="requests-error" style={{ color: tokens.color.red }}>
                {msg}
              </Text>
            </Card>
          ))}
          {anyData && items.length === 0 && (
            <Card style={{ padding: 0 }}>
              <Empty icon="requests">No requests yet.</Empty>
            </Card>
          )}
          {anyData &&
            items.map((item) => {
              const pill =
                item.kind === 'leave'
                  ? { label: titleCase(item.status), tone: LEAVE_STATUS_TONE[item.status] }
                  : registerStatusDisplay(item);
              const showsDeadline =
                item.kind === 'register' && item.status === 'APPROVED' && !!item.expiresAt && !isExpired(item.expiresAt);
              const cancelling = item.kind === 'leave' && cancellingId === item.id;

              return (
                <Card key={`${item.kind}-${item.id}`} testID={`request-row-${item.kind}-${item.id}`}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Pill tone="indigo">{item.kind === 'leave' ? 'Leave' : 'Register change'}</Pill>
                      <Text
                        style={{
                          fontFamily: font.serif,
                          fontWeight: '700',
                          fontSize: 15,
                          color: tokens.color.ink,
                          marginTop: 6,
                        }}
                      >
                        {item.title}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                        {item.detail}
                        {item.reason ? ` · ${item.reason}` : ''}
                      </Text>
                      {showsDeadline && item.kind === 'register' && item.expiresAt && (
                        <Text style={{ fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>
                          Expires {formatDateTime(item.expiresAt)}
                        </Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 8 }}>
                      {/* A `Pill`, not a stamp. `stampStyle` RESTS at
                          `rotate(-2deg)`, so every decision in this list sat
                          permanently crooked inside a right-aligned column —
                          the misalignment reads as a rendering fault, not as
                          character, and it is the office's answer that has to
                          be unambiguous here. */}
                      <Pill tone={pill.tone}>{pill.label}</Pill>
                      {item.kind === 'leave' && item.cancellable && (
                        <Pressable
                          testID={`cancel-${item.id}`}
                          disabled={cancelling}
                          onPress={() => confirmCancel(item.id)}
                          style={{ opacity: cancelling ? 0.6 : 1 }}
                        >
                          <Text style={{ color: tokens.color.red, fontWeight: '700', fontSize: 12 }}>
                            {cancelling ? 'Cancelling…' : 'Cancel'}
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </Card>
              );
            })}
        </>
      )}
    </Screen>
  );
}
