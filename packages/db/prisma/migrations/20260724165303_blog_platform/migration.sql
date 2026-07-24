-- CreateEnum
CREATE TYPE "BlogScope" AS ENUM ('PLATFORM', 'SCHOOL');

-- CreateEnum
CREATE TYPE "BlogStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "BlogGlobalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "SchoolProfile" ADD COLUMN     "blogHeroLimit" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "blogLayout" TEXT NOT NULL DEFAULT 'HERO_GRID';

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" UUID NOT NULL,
    "scope" "BlogScope" NOT NULL,
    "schoolId" UUID,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "heroImageUrl" TEXT,
    "readMinutes" INTEGER NOT NULL DEFAULT 4,
    "sections" JSONB NOT NULL,
    "status" "BlogStatus" NOT NULL DEFAULT 'DRAFT',
    "globalStatus" "BlogGlobalStatus" NOT NULL DEFAULT 'NONE',
    "globalSlug" TEXT,
    "rejectReason" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolBlogSelection" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "isHero" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolBlogSelection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_globalSlug_key" ON "BlogPost"("globalSlug");

-- CreateIndex
CREATE INDEX "BlogPost_scope_globalStatus_status_publishedAt_idx" ON "BlogPost"("scope", "globalStatus", "status", "publishedAt" DESC);

-- CreateIndex
CREATE INDEX "BlogPost_schoolId_status_publishedAt_idx" ON "BlogPost"("schoolId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_schoolId_slug_key" ON "BlogPost"("schoolId", "slug");

-- CreateIndex
CREATE INDEX "SchoolBlogSelection_schoolId_isHero_sortOrder_idx" ON "SchoolBlogSelection"("schoolId", "isHero", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolBlogSelection_schoolId_postId_key" ON "SchoolBlogSelection"("schoolId", "postId");

-- AddForeignKey
ALTER TABLE "BlogPost" ADD CONSTRAINT "BlogPost_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolBlogSelection" ADD CONSTRAINT "SchoolBlogSelection_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolBlogSelection" ADD CONSTRAINT "SchoolBlogSelection_postId_fkey" FOREIGN KEY ("postId") REFERENCES "BlogPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
