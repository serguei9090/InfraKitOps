// Authed read path at rising RPS. Find p95/p99 vs load and where errors start.
// Run:  BASE=... TOKEN=... k6 run loadtest/api-read.js
import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE || 'http://localhost:8080'
const TOKEN = __ENV.TOKEN || ''
const H = { headers: { authorization: `Bearer ${TOKEN}` } }

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 800,
      stages: [
        { target: 100, duration: '30s' },
        { target: 500, duration: '1m' },
        { target: 1000, duration: '1m' },
        { target: 1000, duration: '30s' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{name:health}': ['p(99)<300'],
  },
}

export default function () {
  // /health is authexempt but still traverses the full middleware stack.
  const h = http.get(`${BASE}/api/v1/health`, { ...H, tags: { name: 'health' } })
  check(h, { 'health ok': (r) => r.status === 200 })

  if (TOKEN) {
    const list = http.get(`${BASE}/api/v1/runbooks`, { ...H, tags: { name: 'runbooks' } })
    check(list, { 'runbooks ok': (r) => r.status === 200 || r.status === 503 })
  }
}
