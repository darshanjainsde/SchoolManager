import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { disconnectAll } from '@skoolos/db';
import { AppModule } from '../src/app.module';
import { signSchoolToken, seedMinimalSchool } from './integration/helpers';

/**
 * The school's public website is not student-editable.
 *
 * `SchoolPagesController` and `DesignDraftsController` shipped with
 * `@UseGuards(SchoolJwtGuard)` and nothing else. That guard establishes WHICH
 * school you belong to; it does not look at your role at all. So every route
 * on both controllers — including "publish this draft to the live site" and
 * "delete this page" — was reachable with a STUDENT or PARENT token.
 *
 * Found because `route-coverage.e2e-spec.ts` was red: both controllers were in
 * neither the reviewed nor the unreviewed bucket, so nobody had ever looked at
 * them. That is exactly the failure mode that guard exists to surface, and it
 * is the second time it has surfaced this shape (see StaffController).
 */
describe('site authoring authorization', () => {
  let app: INestApplication;
  let host: string;
  let studentToken: string;
  let parentToken: string;
  let teacherToken: string;
  let adminToken: string;

  beforeAll(async () => {
    const seeded = await seedMinimalSchool();
    host = seeded.host;
    const schoolId = seeded.schoolId;
    studentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'STUDENT' });
    parentToken = signSchoolToken({ sub: seeded.studentUserId, schoolId, role: 'PARENT' });
    teacherToken = signSchoolToken({ sub: seeded.teacherUserId, schoolId, role: 'TEACHER' });
    adminToken = signSchoolToken({ sub: seeded.adminUserId, schoolId, role: 'SCHOOL_ADMIN' });

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await disconnectAll();
  });

  const send = (method: 'get' | 'post' | 'put' | 'delete', path: string, token: string) =>
    request(app.getHttpServer())[method](path).set('Host', host).set('Authorization', `Bearer ${token}`);

  // Every route on both controllers, by hand — a loop over a list read off the
  // controller would pass just as happily if the controller lost a route.
  const ID = '00000000-0000-4000-8000-000000000001';
  const ROUTES: [string, 'get' | 'post' | 'put' | 'delete', string][] = [
    // The rest of /site, added after the first pass fixed only the two that
    // happened to be making the route-coverage guard red. They carried the
    // identical defect, and the enquiries pair is the sharpest: those hand back
    // other families' names, phone numbers and email addresses.
    ['read admission enquiries', 'get', '/site/enquiries'],
    ['read the site content', 'get', '/site/content'],
    ['rewrite the homepage', 'put', '/site/homepage'],
    ['list site media', 'get', '/site/media'],
    ['delete site media', 'delete', `/site/media/${ID}`],
    ['list courses', 'get', '/site/courses'],
    ['create a course', 'post', '/site/courses'],
    ['delete a course', 'delete', `/site/courses/${ID}`],
    ['list featured staff', 'get', '/site/staff'],
    ['create featured staff', 'post', '/site/staff'],
    ['delete featured staff', 'delete', `/site/staff/${ID}`],
    ['read admissions settings', 'get', '/site/admissions'],
    ['rewrite the admissions steps', 'put', '/site/admissions/steps'],
    ['read the hall of fame', 'get', '/site/hall-of-fame'],
    // The other three consoles that carried a school token and no role.
    ['list blog posts', 'get', '/cms/blog/posts'],
    ['create a blog post', 'post', '/cms/blog/posts'],
    ['list job posts', 'get', '/manage/jobs'],
    ['create a job post', 'post', '/manage/jobs'],
    ['read applications', 'get', `/manage/jobs/${ID}/applications`],
    ['list events', 'get', '/manage/events'],
    ['create an event', 'post', '/manage/events'],
    ['list pages', 'get', '/site/pages'],
    ['create a page', 'post', '/site/pages'],
    ['edit a page', 'put', '/site/pages/00000000-0000-4000-8000-000000000001'],
    ['delete a page', 'delete', '/site/pages/00000000-0000-4000-8000-000000000001'],
    ['list design drafts', 'get', '/site/design-drafts'],
    ['create a design draft', 'post', '/site/design-drafts'],
    ['edit a design draft', 'put', '/site/design-drafts/00000000-0000-4000-8000-000000000001'],
    ['delete a design draft', 'delete', '/site/design-drafts/00000000-0000-4000-8000-000000000001'],
    ['publish a design draft', 'post', '/site/design-drafts/00000000-0000-4000-8000-000000000001/publish'],
  ];

  for (const [what, method, path] of ROUTES) {
    it(`a STUDENT cannot ${what}`, async () => {
      const res = await send(method, path, studentToken);
      expect(res.status).toBe(403);
    });

    it(`a PARENT cannot ${what}`, async () => {
      const res = await send(method, path, parentToken);
      expect(res.status).toBe(403);
    });

    it(`a TEACHER cannot ${what}`, async () => {
      const res = await send(method, path, teacherToken);
      expect(res.status).toBe(403);
    });
  }

  // The other half of the check: the fix must not lock out the person whose
  // job this is. A 403 here would mean the guard is simply off.
  it('a SCHOOL_ADMIN can still list pages', async () => {
    const res = await send('get', '/site/pages', adminToken);
    expect(res.status).not.toBe(403);
  });

  it('a SCHOOL_ADMIN can still list design drafts', async () => {
    const res = await send('get', '/site/design-drafts', adminToken);
    expect(res.status).not.toBe(403);
  });

  /**
   * The other half of the fix: the PUBLIC jobs board is public on purpose.
   *
   * `jobs.controller.ts` holds two controllers, and the careless version of
   * this change guards both — which would take the school's vacancies off the
   * internet, where the entire point is that a stranger can read them.
   */
  it('leaves the public jobs board reachable with no token at all', async () => {
    const res = await request(app.getHttpServer()).get('/public/jobs').set('Host', host);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
