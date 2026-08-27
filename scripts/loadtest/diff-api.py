"""Differential API test: same DB, same token, same data — call every GET route
on the pre-change (:3007) and post-change (:3006) APIs and compare byte-for-byte.

This is the check the mock-based unit tests cannot make: they prove the `where`
clause changed as intended; only this proves the query still returns the same rows.
"""
import json, subprocess, sys, urllib.request, urllib.error

SP = '/private/tmp/claude-501/-Users-darshanjain/0a40cae4-763b-444f-b8e9-4002e1b967dc/scratchpad'
slug, school, section, student, teacher, grade, ay, subject = open(f'{SP}/ids.txt').read().strip().split('|')
tok = open(f'{SP}/tok.txt').read().strip()
routes = [r.strip() for r in open(f'{SP}/get-routes.txt') if r.strip()]

SUBS = {
    ':id': section, ':classSectionId': section, ':studentId': student,
    ':teacherId': teacher, ':gradeId': grade, ':academicYearId': ay,
    ':subjectId': subject, ':slug': slug, ':year': '2026',
    ':date': '2026-07-01', ':schoolId': school, ':examId': section,
}

def fetch(port, path):
    url = f'http://localhost:{port}{path}'
    req = urllib.request.Request(url, headers={'Host': f'{slug}.localhost', 'Authorization': f'Bearer {tok}'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        return -1, f'ERR {e}'

compared = skipped = same = diff = 0
diffs = []
for route in routes:
    path = route
    for k, v in SUBS.items():
        path = path.replace(k, v)
    if ':' in path.split('?')[0]:
        skipped += 1
        continue
    if path.startswith('/manage/attendance'):
        path += '?classSectionId=' + section + '&date=2026-07-01'
    sa, ba = fetch(3006, path)
    sb, bb = fetch(3007, path)
    compared += 1
    if sa == sb and ba == bb:
        same += 1
    else:
        diff += 1
        diffs.append((path, sa, sb, ba[:200], bb[:200]))

print(f'routes in manifest : {len(routes)}')
print(f'skipped (unresolved path params) : {skipped}')
print(f'compared           : {compared}')
print(f'IDENTICAL          : {same}')
print(f'DIFFERENT          : {diff}')
if diffs:
    print('\n── differences ──')
    for p, sa, sb, ba, bb in diffs:
        print(f'\n  {p}\n    after (:3006) HTTP {sa}: {ba}\n    before(:3007) HTTP {sb}: {bb}')
