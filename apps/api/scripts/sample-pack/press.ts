import { CertificateService } from '../../src/modules/press/certificate.service';
import { ReportCardService } from '../../src/modules/press/report-card.service';
import { Ctx } from './ctx';

/**
 * The Press register — report cards and certificates — written by the real
 * issue services, so each carries its own serial, payload and school header.
 * Report cards for the classes that sit board exams and one middle class;
 * bonafide and character certificates for a spread of children.
 */
export async function press(c: Ctx): Promise<void> {
  const { p, r, schoolId } = c;
  const cards = new ReportCardService();
  const certs = new CertificateService(cards);
  const actor = c.officeUserId;

  const window = await p.reportWindow.findFirstOrThrow({ where: { schoolId } });
  const wanted = ['X-A', 'X-B', 'XII-A', 'XII-B', 'VIII-A'];
  let issued = 0;
  for (const label of wanted) {
    const sec = c.sections.find((s) => s.label === label);
    if (!sec) continue;
    const res = await cards.issueBatch(schoolId, { windowId: window.id, classSectionId: sec.id }, actor);
    issued += res.issued?.length ?? (res as { count?: number }).count ?? 0;
  }
  c.counts.PressReportCards = issued;

  const sample = r.shuffle(c.students.filter((s) => s.gradeIdx >= 3)).slice(0, 28);
  const purposes = ['Scholarship application', 'Passport application', 'Bank account opening', 'Entrance examination form'];
  let n = 0;
  for (const [i, stu] of sample.entries()) {
    await certs.issue(schoolId, i % 4 === 3
      ? { studentId: stu.id, type: 'CHARACTER', conduct: 'Good' }
      : { studentId: stu.id, type: 'BONAFIDE', purpose: purposes[i % purposes.length]! }, actor);
    n += 1;
  }
  c.counts.PressCertificates = n;
}
