export { ManagementModule } from './management.module';
export { CatalogService } from './catalog.service';
export { TimetableService } from './timetable.service';
export { HolidaysService } from './holidays.service';
export { DiaryService } from './diary.service';
// Shared IST-day plumbing, consumed by the library module (module boundaries
// allow siblings only through this index). CronSecretGuard lives in
// common/auth now.
export { istTodayISO, startOfIstDay, resolveAsOfDate } from './internal/timetable-date';
// The leave desk and its date helpers, consumed by the WhatsApp module so an
// Approve tapped in a chat runs the very same code path as the console.
export { LeaveService } from './leave.service';
export { isoWeekdayOf, toDateStr } from './internal/leave-dates';
