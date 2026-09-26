import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import {
  CONCERN_CATEGORY_LABEL, CONCERN_STATUS_LABEL,
  type ConcernDetail, type ConcernStatus,
} from '@skoolos/types';
import { Card, Page, Pill, SectionTitle } from '@/components/ui';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * ONE CONCERN'S THREAD on a phone — shared by the family and the class
 * teacher, because it is the same story and two copies would drift.
 *
 * A private note is DRAWN as one (amber rail, "only the school sees this"),
 * so a teacher writing on a bus can tell at a glance which lines the family
 * reads. The API already withholds those lines from a family, so this is the
 * second of two guards, not the only one.
 */
export function ConcernThread({ concern, viewer, busy, onComment, onStatus, onEscalate, onReopen }: {
  concern: ConcernDetail;
  viewer: 'TEACHER' | 'FAMILY';
  busy?: boolean;
  onComment: (body: string, visibleToFamily: boolean) => void;
  onStatus?: (status: ConcernStatus) => void;
  onEscalate?: () => void;
  onReopen?: (body: string) => void;
}) {
  const tokens = useTokens();
  const [body, setBody] = useState('');
  const [privateNote, setPrivateNote] = useState(false);
  const school = viewer === 'TEACHER';
  const reopening = !school && concern.status === 'RESOLVED' && concern.canReopen;
  const canWrite = school || concern.status !== 'RESOLVED' || concern.canReopen;

  const tone = concern.status === 'RESOLVED' ? 'green' : concern.status === 'IN_PROGRESS' ? 'amber' : 'indigo';
  const send = () => {
    const text = body.trim();
    if (!text) return;
    if (reopening && onReopen) onReopen(text);
    else onComment(text, !privateNote);
    setBody('');
    setPrivateNote(false);
  };

  return (
    <View style={{ gap: 12 }}>
      <Page style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Text style={{ flex: 1, fontFamily: font.serif, fontSize: 17, color: tokens.color.ink }}>{concern.title}</Text>
          <Pill tone={tone}>{CONCERN_STATUS_LABEL[concern.status]}</Pill>
        </View>
        <Text style={{ fontSize: 12, color: tokens.color.sub }}>
          {CONCERN_CATEGORY_LABEL[concern.category]} · {concern.student.name}
          {concern.student.className ? ` · ${concern.student.className}` : ''}
          {' · '}
          {concern.audience === 'CLASS_TEACHER' && concern.assignedTeacher ? `to ${concern.assignedTeacher.name}` : 'to the school office'}
          {concern.escalatedAt ? ' · sent to the office' : ''}
        </Text>
        <Text style={{ fontSize: 14, color: tokens.color.ink, lineHeight: 20 }}>{concern.body}</Text>
      </Page>

      <SectionTitle title="What happened next" />
      {concern.comments.length === 0 ? (
        <Text style={{ fontSize: 13, color: tokens.color.sub }}>Nothing said yet.</Text>
      ) : (
        <Page style={{ padding: 4 }}>
          {concern.comments.map((c) => (
            <View
              key={c.id}
              testID={`concern-entry-${c.id}`}
              style={{
                padding: 10,
                borderLeftWidth: 3,
                borderLeftColor: !c.visibleToFamily ? tokens.color.amber : c.statusTo ? tokens.color.indigo : tokens.color.line,
                backgroundColor: !c.visibleToFamily ? tokens.color.amber50 : 'transparent',
                gap: 2,
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: tokens.color.ink }}>
                {c.author.name}
                <Text style={{ fontWeight: '400', color: tokens.color.sub }}>
                  {'  '}{c.author.role === 'ADMIN' ? 'office' : c.author.role === 'TEACHER' ? 'class teacher' : 'family'}
                </Text>
              </Text>
              {!c.visibleToFamily && (
                <Text style={{ fontSize: 11, fontWeight: '700', color: tokens.color.late }}>only the school sees this</Text>
              )}
              {c.statusTo && (
                <Text style={{ fontSize: 12.5, fontWeight: '700', color: tokens.color.indigo }}>
                  {c.statusFrom ? `${CONCERN_STATUS_LABEL[c.statusFrom]} → ` : ''}{CONCERN_STATUS_LABEL[c.statusTo]}
                </Text>
              )}
              {c.body ? <Text style={{ fontSize: 13.5, color: tokens.color.ink, lineHeight: 19 }}>{c.body}</Text> : null}
            </View>
          ))}
        </Page>
      )}

      {canWrite && (
        <Card style={{ gap: 10 }}>
          <TextInput
            accessibilityLabel={school ? 'Write back to the family' : reopening ? 'Say why you are reopening this' : 'Add to this concern'}
            placeholder={school ? 'Write back to the family…' : reopening ? 'It happened again…' : 'Add something…'}
            placeholderTextColor={tokens.color.sub}
            value={body}
            onChangeText={setBody}
            multiline
            style={{
              borderWidth: 1.5, borderColor: tokens.color.line, backgroundColor: tokens.color.surface,
              borderRadius: 12, padding: 11, minHeight: 84, color: tokens.color.ink, fontSize: 14, textAlignVertical: 'top',
            }}
          />
          {school && (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: privateNote }}
              accessibilityLabel="Keep this between us"
              onPress={() => setPrivateNote((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 44 }}
            >
              <View style={{
                width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                borderColor: privateNote ? tokens.color.late : tokens.color.line,
                backgroundColor: privateNote ? tokens.color.late : 'transparent',
              }} />
              <Text style={{ fontSize: 13.5, color: tokens.color.ink }}>Keep this between us</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !body.trim()}
            onPress={send}
            style={{
              minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: body.trim() ? tokens.color.indigo : tokens.color.line,
            }}
          >
            <Text style={{ color: body.trim() ? tokens.color.onBrand : tokens.color.sub, fontWeight: '700', fontSize: 14.5 }}>
              {reopening ? 'Reopen' : privateNote ? 'Add note' : 'Send'}
            </Text>
          </Pressable>
        </Card>
      )}

      {school && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {onStatus && concern.status === 'OPEN' && (
            <Move label="Looking into it" busy={busy} onPress={() => onStatus('IN_PROGRESS')} />
          )}
          {onStatus && concern.status !== 'RESOLVED' && (
            <Move label="Mark resolved" busy={busy} primary onPress={() => onStatus('RESOLVED')} />
          )}
          {onStatus && concern.status === 'RESOLVED' && (
            <Move label="Open it again" busy={busy} onPress={() => onStatus('OPEN')} />
          )}
          {onEscalate && !concern.escalatedAt && (
            <Move label="Send to the office" busy={busy} onPress={onEscalate} />
          )}
        </View>
      )}

      {!school && concern.status === 'RESOLVED' && !concern.canReopen && (
        <Text style={{ fontSize: 13, color: tokens.color.sub }}>
          This one is closed. If it happens again, raise a new concern.
        </Text>
      )}
    </View>
  );
}

function Move({ label, onPress, busy, primary }: { label: string; onPress: () => void; busy?: boolean; primary?: boolean }) {
  const tokens = useTokens();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={{
        minHeight: 44, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center',
        borderWidth: primary ? 0 : 1.5, borderColor: tokens.color.line,
        backgroundColor: primary ? tokens.color.indigo : tokens.color.surface,
      }}
    >
      <Text style={{ fontWeight: '700', fontSize: 13.5, color: primary ? tokens.color.onBrand : tokens.color.ink }}>{label}</Text>
    </Pressable>
  );
}
