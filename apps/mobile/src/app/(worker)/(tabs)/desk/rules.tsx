import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SPORTS, sportsByGroup, type Sport } from '@skoolos/types';
import { Empty, Page, PageHeader, Pill, Screen, SectionTitle } from '@/components/ui';
import { Button, Eyebrow, Row, SearchBox } from '@/components/desk';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/**
 * THE RULES BOOK — the same text the web desk carries, in a pocket. A
 * sports teacher is asked "how many attempts?" standing at the pit with a
 * phone, not at a laptop, so this is the one part of the desk that had to
 * follow them out to the field.
 *
 * No diagrams: the web owns those SVGs and a drawing of a badminton court
 * is not what settles an argument about a let. The words are the answer.
 */
export default function Rules() {
  const tokens = useTokens();
  const [q, setQ] = useState('');
  const [key, setKey] = useState<string | null>(null);
  const groups = useMemo(() => sportsByGroup(), []);
  const term = q.trim().toLowerCase();
  const hits = useMemo(() => (term.length >= 2 ? SPORTS.filter((s) => s.name.toLowerCase().includes(term)) : []), [term]);
  const sport: Sport | null = key ? SPORTS.find((s) => s.key === key) ?? null : null;

  if (sport) {
    return (
      <Screen>
        <SectionTitle title={sport.name} right={<Button small variant="ghost" testID="rules-back" label="All sports" onPress={() => setKey(null)} />} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginHorizontal: 4 }}>
          <Pill tone="indigo">{sport.group}</Pill>
          <Pill tone="neutral">{sport.teamSize > 1 ? `${sport.teamSize} a side` : 'Individual'}</Pill>
          <Pill tone="neutral">{sport.scoring.label}</Pill>
        </View>
        <Page testID="rules-summary">
          <PageHeader title="In short" icon="notes" />
          <Text style={{ paddingHorizontal: 12, paddingVertical: 10, fontFamily: font.serif, fontSize: 14.5, lineHeight: 21, color: tokens.color.ink }}>{sport.rules.summary}</Text>
        </Page>
        {sport.rules.sections.map((sec) => (
          <Page key={sec.title}>
            <PageHeader title={sec.title} />
            {sec.points.map((p, i) => (
              <View key={p} style={{ flexDirection: 'row', gap: 9, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: tokens.color.line }}>
                <Text style={{ fontFamily: font.mono, fontSize: 11.5, color: tokens.color.sub, marginTop: 2 }}>{i + 1}</Text>
                <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 20, color: tokens.color.ink }}>{p}</Text>
              </View>
            ))}
          </Page>
        ))}
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionTitle title="Rules book" />
      <SearchBox testID="rules-search" value={q} onChangeText={setQ} placeholder="A sport — high jump, kabaddi, chess…" />
      {term.length >= 2 && (
        <Page testID="rules-hits">
          {hits.length === 0 ? <Empty icon="notes">No sport by that name in the book.</Empty> : hits.map((s, i) => (
            <Row key={s.key} first={i === 0} testID={`rules-${s.key}`} title={s.name} sub={s.group} onPress={() => { setKey(s.key); setQ(''); }} />
          ))}
        </Page>
      )}
      {term.length < 2 && groups.map((g) => (
        <View key={g.group} style={{ gap: 6 }}>
          <Eyebrow>{g.group}</Eyebrow>
          <Page>
            {g.sports.map((s, i) => (
              <Row key={s.key} first={i === 0} testID={`rules-${s.key}`} title={s.name} sub={s.teamSize > 1 ? `${s.teamSize} a side · ${s.scoring.label}` : s.scoring.label} onPress={() => setKey(s.key)} />
            ))}
          </Page>
        </View>
      ))}
    </Screen>
  );
}
