-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_schoolId_username_key" ON "User"("schoolId", "username");

