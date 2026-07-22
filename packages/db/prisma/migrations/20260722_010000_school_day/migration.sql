-- CreateEnum
CREATE TYPE "PeriodKind" AS ENUM ('CLASS', 'BREAK');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OFFICE', 'SUPPORT', 'DRIVER', 'HELPER', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('SICK', 'CASUAL', 'EARNED', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PersonAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'ON_LEAVE');

-- DropIndex
DROP INDEX "TimetableSlot_schoolId_classSectionId_dayOfWeek_periodId_ac_key";

-- DropIndex
DROP INDEX "TimetableSlot_schoolId_teacherId_dayOfWeek_periodId_academi_key";

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[];

-- AlterTable
ALTER TABLE "Period" ADD COLUMN     "kind" "PeriodKind" NOT NULL DEFAULT 'CLASS';

-- AlterTable
ALTER TABLE "TimetableSlot" ADD COLUMN     "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "effectiveTo" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Substitution" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "classSectionId" UUID NOT NULL,
    "periodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "originalTeacherId" UUID NOT NULL,
    "substituteTeacherId" UUID,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Substitution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'OTHER',
    "email" TEXT,
    "phone" TEXT,
    "userId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffAttendance" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "teacherId" UUID,
    "staffId" UUID,
    "date" DATE NOT NULL,
    "status" "PersonAttendanceStatus" NOT NULL,
    "markedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveApplication" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Substitution_schoolId_date_idx" ON "Substitution"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Substitution_classSectionId_periodId_date_key" ON "Substitution"("classSectionId", "periodId", "date");

-- CreateIndex
CREATE INDEX "Staff_schoolId_idx" ON "Staff"("schoolId");

-- CreateIndex
CREATE INDEX "StaffAttendance_schoolId_date_idx" ON "StaffAttendance"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_teacherId_date_key" ON "StaffAttendance"("teacherId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "StaffAttendance_staffId_date_key" ON "StaffAttendance"("staffId", "date");

-- CreateIndex
CREATE INDEX "LeaveApplication_schoolId_status_idx" ON "LeaveApplication"("schoolId", "status");

-- CreateIndex
CREATE INDEX "LeaveApplication_schoolId_teacherId_idx" ON "LeaveApplication"("schoolId", "teacherId");

-- CreateIndex
CREATE INDEX "TimetableSlot_schoolId_classSectionId_effectiveFrom_idx" ON "TimetableSlot"("schoolId", "classSectionId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TimetableSlot_schoolId_teacherId_effectiveFrom_idx" ON "TimetableSlot"("schoolId", "teacherId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSlot_schoolId_classSectionId_dayOfWeek_periodId_ac_key" ON "TimetableSlot"("schoolId", "classSectionId", "dayOfWeek", "periodId", "academicYearId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableSlot_schoolId_teacherId_dayOfWeek_periodId_academi_key" ON "TimetableSlot"("schoolId", "teacherId", "dayOfWeek", "periodId", "academicYearId", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Substitution" ADD CONSTRAINT "Substitution_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAttendance" ADD CONSTRAINT "StaffAttendance_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

