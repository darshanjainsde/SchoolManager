-- Leave policy: a school's own leave vocabulary (LeaveTypeDef) and per-teacher
-- yearly grants (LeaveAllocation). `used` is never stored — derived from
-- APPROVED applications so cancellations refund themselves.

CREATE TABLE "LeaveTypeDef" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "builtin" "LeaveType",
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "defaultAnnual" INTEGER NOT NULL DEFAULT 0,
    "carryForwardCap" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveTypeDef_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeaveAllocation" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "teacherId" UUID NOT NULL,
    "typeDefId" UUID NOT NULL,
    "academicYearId" UUID NOT NULL,
    "allotted" INTEGER NOT NULL DEFAULT 0,
    "carriedIn" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaveAllocation_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LeaveApplication" ADD COLUMN "typeDefId" UUID;

CREATE UNIQUE INDEX "LeaveTypeDef_schoolId_name_key" ON "LeaveTypeDef"("schoolId", "name");
CREATE UNIQUE INDEX "LeaveTypeDef_schoolId_builtin_key" ON "LeaveTypeDef"("schoolId", "builtin");
CREATE INDEX "LeaveTypeDef_schoolId_idx" ON "LeaveTypeDef"("schoolId");

CREATE UNIQUE INDEX "LeaveAllocation_schoolId_teacherId_typeDefId_academicYearId_key" ON "LeaveAllocation"("schoolId", "teacherId", "typeDefId", "academicYearId");
CREATE INDEX "LeaveAllocation_schoolId_academicYearId_idx" ON "LeaveAllocation"("schoolId", "academicYearId");

ALTER TABLE "LeaveTypeDef" ADD CONSTRAINT "LeaveTypeDef_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_typeDefId_fkey" FOREIGN KEY ("typeDefId") REFERENCES "LeaveTypeDef"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveAllocation" ADD CONSTRAINT "LeaveAllocation_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeaveApplication" ADD CONSTRAINT "LeaveApplication_typeDefId_fkey" FOREIGN KEY ("typeDefId") REFERENCES "LeaveTypeDef"("id") ON DELETE SET NULL ON UPDATE CASCADE;
