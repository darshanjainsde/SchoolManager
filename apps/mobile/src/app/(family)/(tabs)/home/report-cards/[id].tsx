import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import type { PressSnapshot, ReportCardSnapshot } from '@skoolos/types';
import { useQuery } from '@/lib/query';
import { formatDate } from '@/lib/portal';
import { reportCardHtml } from '@/lib/report-card-html';
import { Toast } from '@/components/ui';
import { ErrorState, Figure, Page, Screen } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

interface MyReportCardDetail { id: string; serial: string; issuedAt: string; snapshot: PressSnapshot }

/**
 * ONE REPORT CARD, as issued. Rendered from the snapshot the office pressed
 * — never recomputed from live marks, so what the family sees is what was
 * signed. School header in the serif, the subject table in mono figures, the
 * remark in the diary's italic, the serial at the foot like a printed form.
 */
export default function ReportCard() {
  const tokens = useTokens();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery<MyReportCardDetail>(id ? `/me/report-cards/${id}` : null);
  const snap = q.data && q.data.snapshot.kind === 'REPORT_CARD' ? (q.data.snapshot as ReportCardSnapshot) : null;
  const [sharing, setSharing] = useState(false);
  const [shareProblem, setShareProblem] = useState<string | null>(null);

  /**
   * SHARE AS PDF — the one screen where "download" is the whole point. The
   * card's own HTML is printed to a file on the phone and handed to the
   * share sheet; nothing goes to a server. The same snapshot the screen
   * draws, so what is shared is what was issued.
   */
  async function share() {
    if (!snap || !q.data) return;
    setSharing(true);
    setShareProblem(null);
    try {
      const { uri } = await Print.printToFileAsync({ html: reportCardHtml(snap, q.data.serial, q.data.issuedAt) });
      if (!(await Sharing.isAvailableAsync())) {
        setShareProblem('Sharing isn’t available on this phone.');
        return;
      }
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${snap.windowName} — ${snap.student.name}`, UTI: 'com.adobe.pdf' });
    } catch {
      setShareProblem('Could not make the PDF — try again.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      {q.loading && <LoadingRows label="Opening the report card…" rows={5} />}
      {q.error && !q.data && <ErrorState error={q.error} onRetry={q.reload} />}
      {q.data && snap && (
        <>
          <Page testID="report-card" style={{ paddingHorizontal: 14, paddingVertical: 14, gap: 10 }}>
            <View style={{ alignItems: 'center', gap: 2 }}>
              <Text style={{ fontFamily: font.serif, fontSize: 19, fontWeight: '700', color: tokens.color.ink, textAlign: 'center' }}>{snap.school.name}</Text>
              {snap.school.addressLine ? <Text style={{ fontSize: 10.5, color: tokens.color.sub, textAlign: 'center' }}>{snap.school.addressLine}</Text> : null}
              <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: tokens.color.indigoDeep, marginTop: 6 }}>
                {snap.windowName} · {snap.academicYearName}
              </Text>
            </View>
            <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.line, paddingTop: 8, gap: 2 }}>
              <Text style={{ fontFamily: font.serif, fontSize: 16, fontWeight: '600', color: tokens.color.ink }}>{snap.student.name}</Text>
              <Text style={{ fontSize: 11.5, color: tokens.color.sub }}>
                {snap.classLabel}{snap.student.rollNo ? ` · Roll ${snap.student.rollNo}` : ''} · Adm. {snap.student.admissionNo}
              </Text>
            </View>

            <View style={{ borderTopWidth: 1.5, borderTopColor: tokens.color.ink, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: tokens.color.line2 }}>
                <Text style={[hdr(tokens), { flex: 1 }]}>Subject</Text>
                <Text style={[hdr(tokens), { width: 74, textAlign: 'right' }]}>Marks</Text>
                <Text style={[hdr(tokens), { width: 44, textAlign: 'right' }]}>%</Text>
                <Text style={[hdr(tokens), { width: 40, textAlign: 'right' }]}>Grade</Text>
              </View>
              {snap.subjects.map((s, i) => (
                <View key={s.subjectId} testID={`rc-subject-${s.subjectId}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: i === snap.subjects.length - 1 ? 0 : 1, borderBottomColor: tokens.color.line }}>
                  <Text style={{ flex: 1, minWidth: 0, fontSize: 13, color: tokens.color.ink }} numberOfLines={1}>{s.subjectName}</Text>
                  <Text style={[num(tokens), { width: 74 }]}>{s.marks == null ? '—' : `${s.marks}/${s.countedMax ?? s.maxMarks}`}</Text>
                  <Text style={[num(tokens), { width: 44 }]}>{s.pct == null ? '—' : `${Math.round(s.pct)}`}</Text>
                  <Text style={[num(tokens), { width: 40, fontWeight: '700' }]}>{s.grade ?? '—'}</Text>
                </View>
              ))}
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Figure label="Overall" value={snap.overall.pct == null ? '—' : `${Math.round(snap.overall.pct)}%`} hint={snap.overall.grade ? `Grade ${snap.overall.grade} · ${snap.overall.marks}/${snap.overall.maxMarks}` : `${snap.overall.marks}/${snap.overall.maxMarks}`} />
              <Figure label="Attendance" value={snap.attendance.pct == null ? '—' : `${Math.round(snap.attendance.pct)}%`} hint={`${snap.attendance.present} of ${snap.attendance.total} days`} tone={snap.attendance.pct != null && snap.attendance.pct < 75 ? 'warn' : undefined} />
            </View>

            {snap.remark ? (
              <View style={{ borderTopWidth: 1, borderTopColor: tokens.color.line, paddingTop: 8 }}>
                <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: tokens.color.sub }}>Remark</Text>
                <Text style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 14, lineHeight: 20, color: tokens.color.ink2, marginTop: 3 }}>{snap.remark}</Text>
                {snap.classTeacherName ? <Text style={{ fontSize: 11, color: tokens.color.sub, marginTop: 4 }}>— {snap.classTeacherName}, class teacher</Text> : null}
              </View>
            ) : null}

            <Text style={{ fontFamily: font.mono, fontSize: 10, color: tokens.color.sub, textAlign: 'center', marginTop: 6 }}>
              {q.data.serial} · issued {formatDate(q.data.issuedAt)}
            </Text>
          </Page>
          <Pressable
            testID="report-card-share"
            accessibilityRole="button"
            accessibilityState={{ disabled: sharing }}
            disabled={sharing}
            onPress={() => void share()}
            style={({ pressed }) => ({ minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.indigo, opacity: sharing ? 0.6 : pressed ? 0.8 : 1 })}
          >
            <Text style={{ color: tokens.color.onBrand, fontWeight: '700', fontSize: 14 }}>{sharing ? 'Making the PDF…' : 'Share as PDF'}</Text>
          </Pressable>
          {shareProblem && <Toast kind="error" message={shareProblem} testID="report-card-share-error" />}
        </>
      )}
    </Screen>
  );
}

const hdr = (t: ReturnType<typeof useTokens>) => ({ fontSize: 9.5, fontWeight: '700' as const, letterSpacing: 0.8, textTransform: 'uppercase' as const, color: t.color.sub });
const num = (t: ReturnType<typeof useTokens>) => ({ fontFamily: font.mono, fontSize: 12.5, color: t.color.ink, textAlign: 'right' as const });
