import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { ClassDayStatus } from '@skoolos/types';
import { Card, Pill } from './ui';
import { useTokens } from '@/theme/theme-context';

export interface LockedDayCardProps {
  /**
   * Unique per class+date. Every internal testID is namespaced off this so
   * several cards rendered on one screen (one past date, many classes) never
   * collide.
   */
  testID: string;
  className: string;
  /** YYYY-MM-DD. */
  date: string;
  status: ClassDayStatus | null;
  /** True once a PENDING request for this exact class+date is already open. */
  requestPending: boolean;
  /**
   * True while the caller is still fetching whether a request is already
   * open. Until that resolves we don't know if `requestPending` is
   * meaningful, so the form must not be offered — otherwise a teacher can
   * submit a duplicate request in that window and hit the server's 409
   * (`REGISTER_CHANGE_OPEN`) as a dead-end instead of being blocked by the
   * UI. Mirrors the same guard in apps/web/components/teacher/LockedDay.tsx —
   * a review on the web found the form submittable in exactly this window.
   */
  requestsLoading: boolean;
  isSubmitting: boolean;
  /** Server `message`, verbatim, from a failed request-change submission. */
  error?: string | null;
  onRequestChange: (reason: string) => void;
}

/**
 * Replaces the normal take/retake row for a class on a past date that has no
 * unexpired APPROVED unlock — the server refuses a write for a closed day
 * with `409 REGISTER_LOCKED` (see `AttendanceService.save`), and a teacher
 * should never discover that by submitting. This component owns no network
 * calls: the caller (the staff attendance list) already has `status` (from
 * `GET /manage/attendance/status`) and `mine` (from
 * `GET /manage/register-changes/mine`) and reports a trimmed reason back up
 * via `onRequestChange`. Mirrors apps/web/components/teacher/LockedDay.tsx so
 * the two clients never promise different things about the same closed day.
 */
export function LockedDayCard({
  testID,
  className,
  date,
  status,
  requestPending,
  requestsLoading,
  isSubmitting,
  error = null,
  onRequestChange,
}: LockedDayCardProps) {
  const tokens = useTokens();
  const inputStyle = {
    borderWidth: 1,
    borderColor: tokens.color.line,
    borderRadius: 11,
    padding: 11,
    fontSize: 13.5,
    color: tokens.color.ink,
    minHeight: 64,
    textAlignVertical: 'top' as const,
  };
  const [reason, setReason] = useState('');
  const taken = status?.taken ?? false;
  const canSubmit = reason.trim().length > 0 && !isSubmitting;

  const submit = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onRequestChange(trimmed);
  };

  return (
    <Card testID={testID}>
      <Text style={{ fontWeight: '700', fontSize: 14, color: tokens.color.ink }}>
        {className} · {date} is closed
      </Text>
      <Text style={{ color: tokens.color.sub, fontSize: 11.5, marginTop: 4 }}>
        Past days close once they pass so the record can be trusted. Ask your admin to reopen this
        day from Requests if it needs a change.
      </Text>

      {taken && status ? (
        <Text style={{ color: tokens.color.ink, fontSize: 12.5, marginTop: 9 }}>
          {`✓ ${status.present} of ${status.total} present${
            status.markedBy ? ` · Taken by ${status.markedBy}` : ''
          }`}
        </Text>
      ) : (
        <Text style={{ color: tokens.color.sub, fontSize: 12.5, marginTop: 9 }}>
          No attendance was recorded for that day.
        </Text>
      )}

      {requestsLoading ? (
        <Text
          testID={`${testID}-loading`}
          style={{ color: tokens.color.sub, fontSize: 12.5, marginTop: 9 }}
        >
          Checking for an existing request…
        </Text>
      ) : requestPending ? (
        <View testID={`${testID}-pending`} style={{ marginTop: 9 }}>
          <Pill tone="indigo">Change request sent — waiting on your admin</Pill>
        </View>
      ) : (
        <View style={{ marginTop: 9, gap: 8 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: tokens.color.sub }}>
            Reason for reopening
          </Text>
          <TextInput
            testID={`${testID}-reason`}
            value={reason}
            onChangeText={setReason}
            placeholder="Why does this day need to be reopened?"
            placeholderTextColor={tokens.color.sub}
            editable={!isSubmitting}
            multiline
            style={inputStyle}
          />
          {error && (
            <Text testID={`${testID}-error`} style={{ color: tokens.color.red, fontSize: 12 }}>
              {error}
            </Text>
          )}
          <Pressable
            testID={`${testID}-submit`}
            onPress={submit}
            disabled={!canSubmit}
            style={{
              backgroundColor: tokens.color.indigo,
              borderRadius: 13,
              padding: 11,
              alignSelf: 'flex-start',
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 13 }}>
              {isSubmitting ? 'Requesting…' : 'Request a change'}
            </Text>
          </Pressable>
        </View>
      )}
    </Card>
  );
}
