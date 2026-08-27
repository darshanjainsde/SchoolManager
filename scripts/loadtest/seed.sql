-- Realistic multi-tenant seed. Parameterised by :nschools :nstudents :ndays
-- Everything tagged slug 'lt-%' so it is trivially removable.
\set ON_ERROR_STOP on

-- ── Schools ─────────────────────────────────────────────────────────────────
INSERT INTO "School" (id,name,slug,tier,status,timezone,locale,"workingDays","createdAt","updatedAt")
SELECT gen_random_uuid(), 'LoadTest School '||g, 'lt-'||g,
       (ARRAY['BASIC','STANDARD','PRO']::"Tier"[])[1+(g%3)],
       'LIVE','Asia/Kolkata','en-IN', ARRAY[1,2,3,4,5,6], now(), now()
FROM generate_series(1,:nschools) g;

-- ── Academic year ───────────────────────────────────────────────────────────
INSERT INTO "AcademicYear" (id,"schoolId",name,"startDate","endDate","isCurrent")
SELECT gen_random_uuid(), s.id, '2026-27', '2026-04-01','2027-03-31',true
FROM "School" s WHERE s.slug LIKE 'lt-%';

-- ── Grades: 10 per school ───────────────────────────────────────────────────
INSERT INTO "Grade" (id,"schoolId",name,"order")
SELECT gen_random_uuid(), s.id, 'Grade '||g, g
FROM "School" s CROSS JOIN generate_series(1,10) g WHERE s.slug LIKE 'lt-%';

-- ── Subjects: 10 per school ─────────────────────────────────────────────────
INSERT INTO "Subject" (id,"schoolId",name,code)
SELECT gen_random_uuid(), s.id, 'Subject '||g, 'S'||g
FROM "School" s CROSS JOIN generate_series(1,10) g WHERE s.slug LIKE 'lt-%';

-- ── Teachers: 40 per school ─────────────────────────────────────────────────
INSERT INTO "Teacher" (id,"schoolId","firstName","lastName",email,"isActive")
SELECT gen_random_uuid(), s.id, 'Teach'||g, 'Last'||g, 'teacher'||g||'@'||s.slug||'.test', true
FROM "School" s CROSS JOIN generate_series(1,40) g WHERE s.slug LIKE 'lt-%';

-- ── Class sections: 3 per grade = 30 per school ─────────────────────────────
INSERT INTO "ClassSection" (id,"schoolId","gradeId",name,"academicYearId")
SELECT gen_random_uuid(), gr."schoolId", gr.id, sec.n, ay.id
FROM "Grade" gr
JOIN "School" s   ON s.id = gr."schoolId" AND s.slug LIKE 'lt-%'
JOIN "AcademicYear" ay ON ay."schoolId" = gr."schoolId"
CROSS JOIN (VALUES ('A'),('B'),('C')) AS sec(n);

-- ── Students: :nstudents per school, spread across sections ─────────────────
INSERT INTO "Student" (id,"schoolId","admissionNo","firstName","lastName","classSectionId","rollNo","isActive","createdAt")
SELECT gen_random_uuid(), s.id, 'ADM'||g, 'Stu'||g, 'Last'||g,
       cs.id, (g%60)::text, true, now()
FROM "School" s
CROSS JOIN generate_series(1,:nstudents) g
JOIN LATERAL (
  SELECT c.id FROM "ClassSection" c WHERE c."schoolId"=s.id
  ORDER BY c.id OFFSET (g % 30) LIMIT 1
) cs ON true
WHERE s.slug LIKE 'lt-%';
