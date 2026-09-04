// SQLite single-writer ceiling. Many concurrent PUT /prompts/{id} — ramp VUs
// until SQLITE_BUSY / 5xx appears (busy_timeout is 5 s). The write RPS at
// that point is the number that says "you now need Postgres".
//
// Needs --auth on + a token whose user has the `prompt` module.
// Run:  BASE=... TOKEN=... k6 run loadtest/write-contention.js
import http from 'k6/http'
import { check } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const BASE = __ENV.BASE || 'http://localhost:8080'
const TOKEN = __ENV.TOKEN || ''
const H = { headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' } }

const busy = new Counter('writes_rejected')
const okWrites = new Counter('writes_ok')
const writeMs = new Trend('write_ms', true)

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { target: 5, duration: '30s' },
        { target: 15, duration: '1m' },
        { target: 40, duration: '1m' },
        { target: 80, duration: '1m' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: {
    // informational — we WANT to find the breaking point, not fail the run
    writes_rejected: ['count>=0'],
  },
}

export default function () {
  const id = `prompt_lt_${__VU}` // one row per VU → contention on the table, not the row
  const body = JSON.stringify({
    id,
    name: `lt ${__VU}`,
    folderId: null,
    tags: [],
    order: 0,
    variables: {},
    versions: [{ version: 1, createdAt: Date.now(), messages: [{ id: 'm', role: 'user', content: `${__ITER}` }] }],
    draft: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  const res = http.put(`${BASE}/api/v1/prompts/${id}`, body, H)
  writeMs.add(res.timings.duration)
  if (res.status === 200) okWrites.add(1)
  else if (res.status >= 500 || /busy|locked/i.test(res.body || '')) busy.add(1)
  check(res, { 'not a client error': (r) => r.status < 400 || r.status >= 500 })
}
