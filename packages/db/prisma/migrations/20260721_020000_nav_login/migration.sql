-- AlterTable
ALTER TABLE "SchoolProfile" ADD COLUMN     "navLoginLabel" TEXT NOT NULL DEFAULT 'Login',
ADD COLUMN     "navShowLogin" BOOLEAN NOT NULL DEFAULT true;

