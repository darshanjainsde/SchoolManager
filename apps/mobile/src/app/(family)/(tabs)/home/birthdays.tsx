import { Text, View } from 'react-native';
import { ApiError } from '@/lib/api';
import { useQuery } from '@/lib/query';
import { Empty, ErrorState, Page, PageHeader, Screen, SectionTitle } from '@/components/ui';
import { LoadingRows } from '@/components/Loading';
import { useTokens } from '@/theme/theme-context';
import { font } from '@/theme/tokens';

/** One birthday on the wall: day and month only — never a year, an age or an id. */
export interface BirthdayRow { day: number; month: number; name: string; classLabel: string | null; photoUrl: string | null; key: string }
/** `GET /me/birthdays`. `maxAge` is seconds to the SCHOOL's midnight. */
export interface BirthdaysResult { generatedFor: string; window: 'TODAY' | 'WEEK' | 'MONTH'; today: BirthdayRow[]; upcoming: BirthdayRow[]; next: BirthdayRow | null; maxAge: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (r: Pick<BirthdayRow, 'day' | 'month'>) => `${r.day} ${MONTHS[r.month - 1]}`;
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');

/** The slice of `GET /public/site` the wall needs: the school's name, its wish line and its chosen wall style. */
export interface PublicSiteLite {
  school: { name: string };
  celebrations: { page: 'PARTY_WALL' | 'MONTH_PLANNER' | 'NOTICE_BOARD'; wishLine: string } | null;
}

/** "Happy birthday, {first name}! From all of us at {school}." → the words for one child. */
export function fillWish(wish: string, first: string, school: string): string {
  return wish.replace(/\{first name\}/g, first).replace(/\{school\}/g, school);
}
const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * THE BIRTHDAY WALL, for a family. Today first, in the amber the day is
 * allowed; then the ones coming, grouped by date. The wall carries no id and
 * no year by design, so nothing here says how old anyone is. A school that
 * has not switched the wall on for families gets a quiet page, not an error.
 */
export default function Birthdays() {
  const tokens = useTokens();
  const q = useQuery<BirthdaysResult>('/me/birthdays?window=MONTH');
  const d = q.data;
  // The school's own wall settings — its wish line and which wall it chose.
  // Best-effort: the list stands on its own if the site config is unreachable.
  const site = useQuery<PublicSiteLite>('/public/site');
  const wish = site.data?.celebrations?.wishLine ?? null;
  const schoolName = site.data?.school.name ?? 'your school';
  const style = site.data?.celebrations?.page ?? 'PARTY_WALL';

  if (q.error instanceof ApiError && (q.error.status === 403 || q.error.status === 404) && !d) {
    return (
      <Screen>
        <SectionTitle title="Birthdays" />
        <Page><Empty icon="cake">Your school hasn’t switched on the birthday wall for families yet.</Empty></Page>
      </Screen>
    );
  }

  const byDate = new Map<string, BirthdayRow[]>();
  for (const r of d?.upcoming ?? []) byDate.set(dayLabel(r), [...(byDate.get(dayLabel(r)) ?? []), r]);

  return (
    <Screen onRefresh={q.refresh} refreshing={q.refreshing}>
      <SectionTitle title="Birthdays" />
      {q.loading && <LoadingRows label="Loading the birthday wall…" rows={3} />}
      {q.error && !d && <ErrorState error={q.error} onRetry={q.reload} />}
      {d && (
        <>
          <Page testID="birthdays-today" style={{ borderColor: d.today.length ? tokens.color.amber : tokens.color.line, backgroundColor: style === 'PARTY_WALL' && d.today.length ? tokens.color.amber50 : tokens.color.surface }}>
            <PageHeader title={style === 'NOTICE_BOARD' ? 'On the board today' : 'Today'} icon={style === 'PARTY_WALL' ? 'cake' : undefined} />
            {d.today.length === 0 ? (
              <Empty icon="cake">{d.next ? `Nobody today. Next: ${d.next.name}, ${dayLabel(d.next)}.` : 'Nobody today.'}</Empty>
            ) : (
              d.today.map((r, i) => (
                <Row key={r.key} r={r} first={i === 0} today wish={style === 'PARTY_WALL' && wish ? fillWish(wish, firstNameOf(r.name), schoolName) : null} />
              ))
            )}
          </Page>
          {[...byDate.entries()].map(([label, rows]) => (
            <Page key={label}>
              <PageHeader title={label} />
              {rows.map((r, i) => <Row key={r.key} r={r} first={i === 0} />)}
            </Page>
          ))}
          {d.upcoming.length === 0 && d.today.length === 0 && (
            <Text style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 12.5, color: tokens.color.sub, textAlign: 'center' }}>Nothing coming up this month.</Text>
          )}
        </>
      )}
    </Screen>
  );
}

function Row({ r, first, today, wish }: { r: BirthdayRow; first: boolean; today?: boolean; wish?: string | null }) {
  const tokens = useTokens();
  return (
    <View testID={`birthday-${r.key}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: first ? 0 : 1, borderTopColor: tokens.color.line }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: today ? tokens.color.amber50 : tokens.color.indigo50 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: today ? tokens.color.late : tokens.color.indigoDeep }}>{initials(r.name)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: font.serif, fontSize: 14.5, fontWeight: '600', color: tokens.color.ink }}>{r.name}</Text>
        {r.classLabel ? <Text style={{ fontSize: 11, color: tokens.color.sub }}>{r.classLabel}</Text> : null}
        {wish ? (
          <Text testID={`wish-${r.key}`} style={{ fontFamily: font.serif, fontStyle: 'italic', fontSize: 12.5, color: tokens.color.late, marginTop: 3, lineHeight: 17 }}>{wish}</Text>
        ) : null}
      </View>
    </View>
  );
}
