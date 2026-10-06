import { shortDayDate } from '../../../common/dates/timetable-date';
import { ApiError } from '../../../common/errors/api-error';
import type { NoticeTopic } from '../../../common/notifications/notification.types';

export type NoticeTopicInput =
  | { kind: 'HOLIDAY'; closedOn: string; occasion: string; resumesOn: string }
  | { kind: 'PTM'; on: string; at: string }
  | { kind: 'TIMING'; on: string; from: string; to: string };

const MAX_HOLIDAY_DAYS = 60;
const bad = (field: string, message: string) => new ApiError('VALIDATION', message, 400, field);

function date(iso: string, field: string): Date {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date(NaN);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw bad(field, 'That is not a real date.');
  return d;
}
function minutes(hhmm: string, field: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) throw bad(field, 'Use a time like 10:30.');
  return Number(m[1]) * 60 + Number(m[2]);
}
const clock = (mins: number) => {
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};
const notPast = (iso: string, today: string, field: string) => { if (iso < today) throw bad(field, 'That date has already passed.'); };

/** Turns what the admin typed into the words WhatsApp sends. Throws a field error a person can fix. */
export function noticeTopicFrom(input: NoticeTopicInput, todayIst: string): NoticeTopic {
  if (input.kind === 'HOLIDAY') {
    const occasion = input.occasion.replace(/\s+/g, ' ').trim();
    if (!occasion || occasion.length > 60) throw bad('topic.occasion', 'Say what the holiday is for, in a few words.');
    const from = date(input.closedOn, 'topic.closedOn');
    const back = date(input.resumesOn, 'topic.resumesOn');
    notPast(input.closedOn, todayIst, 'topic.closedOn');
    if (back <= from) throw bad('topic.resumesOn', 'Classes must resume after the school closes.');
    if ((back.getTime() - from.getTime()) / 86_400_000 > MAX_HOLIDAY_DAYS) throw bad('topic.resumesOn', `A holiday notice covers at most ${MAX_HOLIDAY_DAYS} days.`);
    return { kind: 'HOLIDAY', closedOn: shortDayDate(from), occasion, resumesOn: shortDayDate(back) };
  }
  if (input.kind === 'PTM') {
    const on = date(input.on, 'topic.on');
    notPast(input.on, todayIst, 'topic.on');
    return { kind: 'PTM', on: shortDayDate(on), at: clock(minutes(input.at, 'topic.at')) };
  }
  const on = date(input.on, 'topic.on');
  notPast(input.on, todayIst, 'topic.on');
  const a = minutes(input.from, 'topic.from');
  const b = minutes(input.to, 'topic.to');
  if (b <= a) throw bad('topic.to', 'The day must end after it starts.');
  return { kind: 'TIMING', on: shortDayDate(on), from: clock(a), to: clock(b) };
}
