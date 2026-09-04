// Concurrent SSE streams held open. Watch the connection ceiling, and check
// there's no goroutine/memory leak when clients disconnect.
//
// k6's http can't stream SSE incrementally; we open the connection, read for
// a bounded time, then drop it — enough to exercise the server side.
//
// Run:  BASE=... TOKEN=... k6 run loadtest/sse.js
// Alongside, watch: curl -s $BASE/api/v1/metrics -H "authorization: Bearer $TOKEN" | grep in_flight
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = __ENV.BASE || 'http://localhost:8080'
const TOKEN = __ENV.TOKEN || ''

// A dry-run runbook stream is cheap + needs no real runbook if you pass a
// bogus id (it 404s fast) — swap for a real id + ?author=1 to hold a stream
// open. Adjust STREAM to whatever your instance has.
const STREAM = __ENV.STREAM || `/api/v1/runbooks/does-not-exist/run/stream?dryRun=1`

export const options = {
  scenarios: {
    hold: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { target: 25, duration: '30s' },
        { target: 100, duration: '1m' },
        { target: 200, duration: '1m' },
        { target: 200, duration: '1m' }, // hold — leak check
        { target: 0, duration: '20s' },
      ],
    },
  },
}

export default function () {
  const res = http.get(`${BASE}${STREAM}`, {
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'text/event-stream' },
    timeout: '20s',
  })
  check(res, { 'stream reachable': (r) => r.status === 200 || r.status === 404 || r.status === 403 })
  sleep(Math.random() * 3)
}
