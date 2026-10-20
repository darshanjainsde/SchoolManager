export { ManagementModule } from './management.module';
export { CatalogService } from './catalog.service';
export { TimetableService } from './timetable.service';
export { HolidaysService } from './holidays.service';
export { DiaryService } from './diary.service';
// Shared IST-day plumbing, consumed by the library module (module boundaries
// allow siblings only through this index). CronSecretGuard lives in
// common/auth now.
export { istTodayISO, startOfIstDay, resolveAsOfDate, liveSlotWhere } from './internal/timetable-date';
// The leave desk and its date helpers, consumed by the WhatsApp module so an
// Approve tapped in a chat runs the very same code path as the console.
export { LeaveService } from './leave.service';
export { isoWeekdayOf, toDateStr, todayIstDateStr } from './internal/leave-dates';
// Working days of a school's year, consumed by the syllabus tracker's "expected by today".
export { workingDates } from './internal/school-calendar';
export { isLeaveDesk } from './internal/leave-desk.guard';
