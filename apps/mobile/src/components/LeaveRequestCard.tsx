import { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from './Button';
import { Icon } from './icons';
import { Pill } from './ui';
import { Sheet } from './Sheet';
import { useTokens } from '@/theme/theme-context';
import { fmtWeekdayDay } from '@/lib/dates';
import { leaveTypeLabel } from '@/lib/labels';

/**
 * ONE LEAVE REQUEST, AS A CARD TO DECIDE ON (UI v2, researched 2026-10-08).
 *
 * What Slack, Workday, greytHR, Expensify and Brex agree on: who, what and
 * when on the card; the cost next to the decision; ONE filled Approve, a
 * quieter Reject in the error colour; approve never asks a question, reject
 * confirms first; the card changes in place after the tap. Material 3 card:
 * 16 dp inside, 8 dp between cards, 48 dp buttons.
 *
 * The impact strip (balance after, who else is out, periods to cover) shows
 * only what the server gives: `impact` is optional, and a card without it is
 * still a complete card.
 */
export interface LeaveRequestCardProps {
  id: string;
  name: string;
  /** "Science teacher", "Office" — what the person does. */
  role?: string;
  type: string;
  startDate: string;
  endDate: string;
  halfDay?: boolean;
  halfDayPart?: 'AM' | 'PM' | null;
  reason?: string | null;
  impact?: { balanceAfter?: string; othersOut?: number; periodsToCover?: number };
  busy?: boolean;
  /** Set once decided: the buttons become this line. */
  decided?: 'approved' | 'rejected' | null;
  onApprove: () => void;
  onReject: () => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

function dayCount(a: string, b: string, half?: boolean): string {
  if (half) return 'half day';
  const s = new Date(a.slice(0, 10)); const e = new Date(b.slice(0, 10));
  const n = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
  return n === 1 ? '1 day' : `${n} days`;
}

export function LeaveRequestCard(p: LeaveRequestCardProps) {
  const tokens = useTokens();
  const c = tokens.color;
  const [confirming, setConfirming] = useState(false);
  const same = p.startDate.slice(0, 10) === p.endDate.slice(0, 10);
  const when = same ? fmtWeekdayDay(p.startDate.slice(0, 10)) : `${fmtWeekdayDay(p.startDate.slice(0, 10))} – ${fmtWeekdayDay(p.endDate.slice(0, 10))}`;
  const half = p.halfDay ? (p.halfDayPart === 'AM' ? ' · morning' : p.halfDayPart === 'PM' ? ' · afternoon' : '') : '';
  const strip = p.impact
    ? [
        p.impact.balanceAfter ? { k: 'Balance after', v: p.impact.balanceAfter, warn: false } : null,
        p.impact.othersOut !== undefined ? { k: 'Also out', v: `${p.impact.othersOut} ${p.impact.othersOut === 1 ? 'person' : 'people'}`, warn: p.impact.othersOut > 1 } : null,
        p.impact.periodsToCover !== undefined ? { k: 'To cover', v: `${p.impact.periodsToCover} ${p.impact.periodsToCover === 1 ? 'period' : 'periods'}`, warn: p.impact.periodsToCover > 0 } : null,
      ].filter((x): x is { k: string; v: string; warn: boolean } => !!x)
    : [];

  return (
    <View
      testID={`leave-card-${p.id}`}
      style={{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: tokens.radius.card, padding: 16, gap: 10 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c.indigo50, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: c.indigo, fontWeight: '700', fontSize: 13 }}>{initials(p.name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 16, lineHeight: 24, fontWeight: '600', color: c.ink }}>{p.name}</Text>
          {p.role ? <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, color: c.sub }}>{p.role}</Text> : null}
        </View>
        <Pill tone={p.decided === 'approved' ? 'green' : p.decided === 'rejected' ? 'red' : 'amber'}>
          {p.decided === 'approved' ? 'Approved' : p.decided === 'rejected' ? 'Rejected' : 'Pending'}
        </Pill>
      </View>

      {/* Two short lines, never one long one: a two-weekday range plus the
          count wrapped mid-phrase and clipped to "· 2" on the emulator
          (v2 crawl 2026-10-08). */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ paddingTop: 1 }}><Icon name="requests" size={20} color={c.late} fillOpacity={0.18} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 14, lineHeight: 20, color: c.ink }}>
            <Text style={{ fontWeight: '700' }}>{leaveTypeLabel(p.type)}</Text>
            {' · '}
            <Text style={{ fontVariant: ['tabular-nums'], color: c.ink2 }}>{dayCount(p.startDate, p.endDate, p.halfDay)}{half}</Text>
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 18, color: c.sub, fontVariant: ['tabular-nums'] }}>{when}</Text>
        </View>
      </View>

      {strip.length > 0 ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {strip.map((s) => (
            <View key={s.k} style={{ flex: 1, backgroundColor: s.warn ? c.amber50 : c.surfaceMuted, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 9 }}>
              <Text style={{ fontSize: 11, color: s.warn ? c.late : c.sub }}>{s.k}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: s.warn ? c.late : c.ink, fontVariant: ['tabular-nums'] }}>{s.v}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {p.reason ? (
        <Text numberOfLines={2} style={{ fontSize: 14, lineHeight: 20, color: c.ink2, borderLeftWidth: 2, borderLeftColor: c.line2, paddingLeft: 10 }}>
          “{p.reason}”
        </Text>
      ) : null}

      {p.decided ? (
        <Text testID={`leave-decided-${p.id}`} style={{ fontSize: 13, fontWeight: '600', color: p.decided === 'approved' ? c.green : c.red, paddingTop: 2 }}>
          {p.decided === 'approved' ? 'Approved by you · just now' : 'Rejected by you · just now'}
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
          <View style={{ flex: 48 }}>
            <Button label="Reject" variant="danger" block onPress={() => setConfirming(true)} disabled={p.busy} testID={`reject-${p.id}`} />
          </View>
          <View style={{ flex: 52 }}>
            <Button label="Approve" icon="check" block onPress={p.onApprove} busy={p.busy} testID={`approve-${p.id}`} />
          </View>
        </View>
      )}

      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Reject ${p.name}'s leave?`}
        subtitle={`${leaveTypeLabel(p.type)} · ${when}. They are told at once and can apply again.`}
        testID={`reject-sheet-${p.id}`}
        footer={
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button label="Keep it pending" variant="outlined" block onPress={() => setConfirming(false)} /></View>
            <View style={{ flex: 1 }}><Button label="Reject leave" variant="filled" block onPress={() => { setConfirming(false); p.onReject(); }} testID={`reject-confirm-${p.id}`} /></View>
          </View>
        }
      >
        <View style={{ height: 4 }} />
      </Sheet>
    </View>
  );
}
