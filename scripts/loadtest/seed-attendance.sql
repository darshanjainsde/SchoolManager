\set ON_ERROR_STOP on
INSERT INTO "Attendance" (id,"schoolId","studentId","classSectionId",date,status,"markedById","createdAt")
SELECT gen_random_uuid(), st."schoolId", st.id, st."classSectionId",
       (DATE '2026-06-01' + d)::date,
       (ARRAY['PRESENT','PRESENT','PRESENT','PRESENT','PRESENT','PRESENT','PRESENT','PRESENT','ABSENT','LATE']::"AttendanceStatus"[])[1+((abs(hashtext(st.id::text))+d)%10)],
       t.id, now()
FROM "Student" st
JOIN LATERAL (SELECT tt.id FROM "Teacher" tt WHERE tt."schoolId"=st."schoolId" LIMIT 1) t ON true
CROSS JOIN generate_series(:dfrom,:dto) d
WHERE st."classSectionId" IS NOT NULL;
