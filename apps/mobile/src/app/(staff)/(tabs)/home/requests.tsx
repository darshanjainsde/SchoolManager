import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import type {
  LeaveApplication,
  LeaveBalanceResponse,
  LeaveStatusValue,
  LeaveTypeValue,
  RegisterChangeRow,
} from '@skoolos/types';
import { LEAVE_TYPES } from '@skoolos/types';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';
import { Card, Empty, Pill, Screen, SectionTitle, Toast } from '@/components/ui';
import { Button } from '@/components/Button';
import { Field, fieldInputStyle, TextField } from '@/components/Field';
import { CalendarSheet } from '@/components/CalendarSheet';
import { ChevronDown, SelectField, weekdayDate } from '@/components/Field';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { fmtDate, fmtDateTime } from '@/lib/dates';

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
  return fmtDate(iso.slice(0, 10));
}

/** A real timestamp (unlike the calendar dates above) — read in the
 * device's own local time, since `expiresAt` genuinely means a moment on
 * this device's clock. */
function formatDateTime(iso: string): string {
  return fmtDateTime(iso);
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

export default function Requests() {
  const tokens = useTokens();
  // The same 13/600 label `Field` draws, for the groups that are not a text box.
  const labelStyle = { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, color: tokens.color.ink2 };
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

  // Balances are decoration on this screen — a failure (no policy set up,
  // an older API) hides the chips and never joins the error rail.
  const [balances, setBalances] = useState<LeaveBalanceResponse | null>(null);
  const fetchBalances = useCallback(() => {
    return api
      .request<LeaveBalanceResponse>('/manage/leave-policy/my-balance')
      .then((data) => setBalances(data))
      .catch(() => setBalances(null));
  }, []);

  const fetchAll = useCallback(() => {
    void fetchLeave();
    void fetchRegister();
    void fetchBalances();
  }, [fetchLeave, fetchRegister, fetchBalances]);

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
      // 409: the leave changed under us (the office decided it, or another
      // device cancelled it). The sentence says so; the list must show it too,
      // or the row keeps offering a Cancel that can only fail again.
      if (e instanceof ApiError && e.status === 409) fetchAll();
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
  // Which calendar sheet is up — the From or the To field's.
  const [pickerFor, setPickerFor] = useState<'from' | 'to' | null>(null);

  const dateOrderInvalid = endDate < startDate;
  const canApply = !dateOrderInvalid && !applySubmitting;

  function pickStartDate(iso: string) {
    setStartDate(iso);
    // A From moved past the To drags the To along — the calendar never
    // leaves the range inverted.
    setEndDate((e) => (e < iso ? iso : e));
  }

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
      <Text style={{ fontSize: 14, color: tokens.color.sub, marginHorizontal: 4, marginTop: -6 }}>
        Leave applications and register-change requests, in one place.
      </Text>

      <Card style={{ gap: 12 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>Apply for leave</Text>

        <View>
          {/* A dropdown, each type with its balance (user, 9 Oct 2026). */}
          <SelectField
            label="Type"
            testID="apply-type"
            optionTestID={(t) => `apply-type-${t}`}
            sheetTitle="Type of leave"
            subInField={false}
            value={type}
            options={LEAVE_TYPES.map((t) => {
              const bal = balances?.balances.find((b) => b.builtin === t);
              return {
                id: t,
                label: LEAVE_TYPE_LABEL[t],
                sub: bal && bal.remaining !== null ? `${bal.remaining} ${bal.remaining === 1 ? 'day' : 'days'} left` : undefined,
              };
            })}
            onChange={(t) => setType(t as typeof type)}
          />
          {(() => {
            const bal = balances?.balances.find((b) => b.builtin === type);
            if (!bal || bal.remaining === null) return null;
            return (
              <Text
                testID="apply-balance"
                style={{
                  fontSize: 13,
                  marginTop: 6,
                  color: bal.remaining <= 0 ? tokens.color.red : tokens.color.sub,
                }}
              >
                {bal.remaining} {bal.remaining === 1 ? 'day' : 'days'} left this year
                {bal.carriedIn > 0 ? ` (${bal.carriedIn} carried over)` : ''}
              </Text>
            );
          })()}
        </View>

        {/* Tapping either date opens a month calendar — the old ‹ › steppers
            took a tap per day and never showed which weekday anything fell on. */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(
            [
              { key: 'from' as const, label: 'From', value: startDate, testID: 'apply-from-date' },
              { key: 'to' as const, label: 'To', value: endDate, testID: 'apply-to-date' },
            ]
          ).map((f) => (
            <View key={f.key} style={{ flex: 1 }}>
              <Field label={f.label}>
                {/* The kit's field box, pressed instead of typed: the accent
                    rule inks in while its calendar sheet is up. */}
                <Pressable
                  testID={f.testID}
                  accessibilityRole="button"
                  accessibilityLabel={`${f.label} date: ${f.value}. Opens a calendar.`}
                  disabled={applySubmitting}
                  onPress={() => setPickerFor(f.key)}
                  style={[
                    fieldInputStyle(tokens, { focused: pickerFor === f.key }),
                    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: applySubmitting ? 0.6 : 1 },
                  ]}
                >
                  <Text numberOfLines={1} style={{ fontSize: 15, color: tokens.color.ink, flexShrink: 1 }}>{weekdayDate(f.value)}</Text>
                  <ChevronDown color={tokens.color.sub} />
                </Pressable>
              </Field>
            </View>
          ))}
        </View>

        {dateOrderInvalid && (
          <Text testID="apply-date-order-error" style={{ color: tokens.color.red, fontSize: 13 }}>
            The end date must be on or after the start date.
          </Text>
        )}

        <CalendarSheet
          open={pickerFor === 'from'}
          title="Leave starts"
          value={startDate}
          onPick={pickStartDate}
          onClose={() => setPickerFor(null)}
        />
        <CalendarSheet
          open={pickerFor === 'to'}
          title="Leave ends"
          value={endDate}
          minDate={startDate}
          onPick={setEndDate}
          onClose={() => setPickerFor(null)}
        />

        <TextField
          label="Reason"
          optional
          testID="apply-reason"
          value={reason}
          onChangeText={setReason}
          placeholder="A short note for your admin"
          editable={!applySubmitting}
          multiline
        />

        {applyError && (
          <Text testID="apply-error" style={{ color: tokens.color.red, fontSize: 13 }}>
            {applyError}
          </Text>
        )}

        <Button
          testID="apply-submit"
          block
          busy={applySubmitting}
          disabled={!canApply}
          label={applySubmitting ? 'Submitting…' : 'Submit request'}
          onPress={submitApply}
        />

        {applySuccess && (
          <Toast kind="success" testID="apply-success" message="Leave request submitted — your admin will review it." />
        )}
      </Card>

      <Card style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: tokens.color.ink }}>My requests</Text>
          <Text style={{ fontSize: 13, color: tokens.color.sub }}>{items.length} total</Text>
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
                          fontWeight: '700',
                          fontSize: 17,
                          color: tokens.color.ink,
                          marginTop: 6,
                        }}
                      >
                        {item.title}
                      </Text>
                      <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>
                        {item.detail}
                        {item.reason ? ` · ${item.reason}` : ''}
                      </Text>
                      {showsDeadline && item.kind === 'register' && item.expiresAt && (
                        <Text style={{ fontSize: 13, color: tokens.color.sub, marginTop: 2 }}>
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
                        <Button
                          testID={`cancel-${item.id}`}
                          variant="danger"
                          size="sm"
                          label={cancelling ? 'Cancelling…' : 'Cancel'}
                          busy={cancelling}
                          disabled={cancelling}
                          onPress={() => confirmCancel(item.id)}
                        />
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
