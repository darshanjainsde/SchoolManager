import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { TeachersService } from './teachers.service';
import { TeachersController } from './teachers.controller';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { ClassesService } from './classes.service';
import { ClassesController } from './classes.controller';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';
import { TimetableService } from './timetable.service';
import { TimetableController } from './timetable.controller';
import { TeacherDayService } from './teacher-day.service';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceController } from './staff-attendance.controller';
import { ExamsService } from './exams.service';
import { ExamsController } from './exams.controller';
import { ExamRemindersService } from './exam-reminders.service';
import { ExamRemindersController } from './exam-reminders.controller';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationOutboxController } from './notification-outbox.controller';
import { CronSecretGuard } from './cron-secret.guard';
import { LoginInviteService } from './internal/login-invite.service';
import { LeaveService } from './leave.service';
import { LeaveController, SubstitutionController } from './leave.controller';
import { HolidaysService } from './holidays.service';
import { HolidaysController } from './holidays.controller';
import { ClassNotesService } from './class-notes.service';
import { ClassNotesController } from './class-notes.controller';
import { RegisterChangeService } from './register-change.service';
import { RegisterChangeController } from './register-change.controller';
import { AssignmentsService } from './assignments.service';
import { AssignmentsController } from './assignments.controller';
import { MessagesService } from './messages.service';
import { StudentMessagesController } from './student-messages.controller';
import { TeacherMessagesController } from './teacher-messages.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { RequestsController } from './requests.controller';
import { PhotoService } from './photo.service';
import { PhotoController } from './photo.controller';

@Module({
  imports: [AuthModule, FeaturesModule, TenancyModule],
  providers: [CatalogService, TeachersService, StaffService, ClassesService, StudentsService, TimetableService, TeacherDayService, AnnouncementsService, AttendanceService, StaffAttendanceService, ExamsService, ExamRemindersService, NotificationOutboxService, CronSecretGuard, LoginInviteService, LeaveService, HolidaysService, ClassNotesService, RegisterChangeService, AssignmentsService, MessagesService, NotificationsService, PhotoService],
  controllers: [
    CatalogController,
    TeachersController,
    StaffController,
    ClassesController,
    StudentsController,
    TimetableController,
    AnnouncementsController,
    AttendanceController,
    StaffAttendanceController,
    ExamsController,
    ExamRemindersController,
    NotificationOutboxController,
    LeaveController,
    SubstitutionController,
    HolidaysController,
    ClassNotesController,
    RegisterChangeController,
    AssignmentsController,
    StudentMessagesController,
    TeacherMessagesController,
    NotificationsController,
    RequestsController,
    PhotoController,
  ],
  exports: [CatalogService, TeachersService, StaffService, ClassesService, StudentsService, TimetableService, TeacherDayService, AnnouncementsService, AttendanceService, StaffAttendanceService, ExamsService, LeaveService, HolidaysService, ClassNotesService, RegisterChangeService, AssignmentsService],
})
export class ManagementModule {}
