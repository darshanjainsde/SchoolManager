import type { ReportCardSnapshot } from '@skoolos/types';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/**
 * The card as a printable page — the same snapshot the screen renders, laid
 * out for A4 so a family can keep or forward the PDF. Serif for the school
 * and the child, a ruled table for the subjects, the remark in italic, the
 * serial at the foot: the printed form the office already issues.
 */
export function reportCardHtml(snap: ReportCardSnapshot, serial: string, issuedAt: string): string {
  const issued = new Date(issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const rows = snap.subjects
    .map(
      (s) => `<tr><td>${esc(s.subjectName)}</td><td class="n">${s.marks == null ? '—' : `${s.marks}/${s.countedMax ?? s.maxMarks}`}</td><td class="n">${s.pct == null ? '—' : Math.round(s.pct)}</td><td class="n b">${esc(s.grade ?? '—')}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(snap.windowName)} — ${esc(snap.student.name)}</title>
<style>
@page{size:A4;margin:18mm}
body{font-family:Georgia,"Times New Roman",serif;color:#211D45;margin:0;font-size:13px}
h1{font-size:22px;margin:0;text-align:center}.addr{text-align:center;color:#666;font-size:11px;margin-top:2px}
.win{text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#3730A3;margin:10px 0 14px}
.who{border-top:1px solid #ddd;padding-top:8px}.who b{font-size:16px}.who small{display:block;color:#666;font-size:11px;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-top:14px;border-top:2px solid #211D45}
th{font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#666;text-align:left;padding:7px 4px;border-bottom:1px solid #999}
td{padding:7px 4px;border-bottom:1px solid #e5e5e5}td.n{text-align:right;font-family:Menlo,Consolas,monospace;font-size:12px}td.b{font-weight:700}
.tot{display:flex;gap:14px;margin-top:14px}.tot div{flex:1;border:1px solid #ddd;border-radius:8px;padding:8px 10px}.tot .l{font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#666}.tot .v{font-family:Menlo,Consolas,monospace;font-size:18px;font-weight:700;margin-top:2px}
.rem{margin-top:14px;border-top:1px solid #ddd;padding-top:8px}.rem .l{font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#666}.rem p{font-style:italic;margin:4px 0 0;line-height:1.5}.rem small{color:#666}
.foot{margin-top:18px;text-align:center;font-family:Menlo,Consolas,monospace;font-size:10px;color:#666}
</style></head><body>
<h1>${esc(snap.school.name)}</h1>
${snap.school.addressLine ? `<div class="addr">${esc(snap.school.addressLine)}</div>` : ''}
<div class="win">${esc(snap.windowName)} · ${esc(snap.academicYearName)}</div>
<div class="who"><b>${esc(snap.student.name)}</b><small>${esc(snap.classLabel)}${snap.student.rollNo ? ` · Roll ${esc(snap.student.rollNo)}` : ''} · Adm. ${esc(snap.student.admissionNo)}</small></div>
<table><thead><tr><th>Subject</th><th style="text-align:right">Marks</th><th style="text-align:right">%</th><th style="text-align:right">Grade</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot">
  <div><div class="l">Overall</div><div class="v">${snap.overall.pct == null ? '—' : `${Math.round(snap.overall.pct)}%`}</div><div class="l">${snap.overall.grade ? `Grade ${esc(snap.overall.grade)} · ` : ''}${snap.overall.marks}/${snap.overall.maxMarks}</div></div>
  <div><div class="l">Attendance</div><div class="v">${snap.attendance.pct == null ? '—' : `${Math.round(snap.attendance.pct)}%`}</div><div class="l">${snap.attendance.present} of ${snap.attendance.total} days</div></div>
</div>
${snap.remark ? `<div class="rem"><div class="l">Remark</div><p>${esc(snap.remark)}</p>${snap.classTeacherName ? `<small>— ${esc(snap.classTeacherName)}, class teacher</small>` : ''}</div>` : ''}
<div class="foot">${esc(serial)} · issued ${esc(issued)}</div>
</body></html>`;
}
