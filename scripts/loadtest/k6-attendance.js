import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const auth = new SharedArray('auth', () =>
  open('/private/tmp/claude-501/-Users-darshanjain/0a40cae4-763b-444f-b8e9-4002e1b967dc/scratchpad/lt/auth.jsonl')
    .trim().split('\n').map(JSON.parse));

const attLatency = new Trend('attendance_latency', true);
const errRate = new Rate('errors');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '20s', target: 5 },
        { duration: '20s', target: 10 },
        { duration: '20s', target: 25 },
        { duration: '20s', target: 50 },
        { duration: '30s', target: 100 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: { http_req_failed: ['rate<0.05'] },
  summaryTrendStats: ['avg','min','med','p(90)','p(95)','p(99)','max'],
};

export default function () {
  const a = auth[Math.floor(Math.random() * auth.length)];
  const day = Math.floor(Math.random() * 90);
  const d = new Date(Date.UTC(2026, 5, 1) + day * 86400000).toISOString().slice(0, 10);
  const res = http.get(
    `http://localhost:3005/manage/attendance?classSectionId=${a.section}&date=${d}`,
    { headers: { Host: `${a.slug}.localhost`, Authorization: `Bearer ${a.token}` }, timeout: '120s' });
  attLatency.add(res.timings.duration);
  errRate.add(res.status !== 200);
  check(res, { 'status 200': (r) => r.status === 200 });
}
