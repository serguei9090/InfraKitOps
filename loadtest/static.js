// Static-serving throughput: the SPA shell + a hashed asset.
// Run:  k6 run loadtest/static.js
import http from 'k6/http'
import { check } from 'k6'

const BASE = __ENV.BASE || 'http://localhost:8080'

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { target: 200, duration: '30s' },
        { target: 800, duration: '1m' },
        { target: 800, duration: '1m' },
        { target: 0, duration: '15s' },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(99)<500'],
  },
}

// Discover a hashed asset once, from index.html.
let assetPath
export function setup() {
  const idx = http.get(`${BASE}/`)
  const m = idx.body && idx.body.match(/\/assets\/[A-Za-z0-9_-]+\.js/)
  return { asset: m ? m[0] : null }
}

export default function (data) {
  const idx = http.get(`${BASE}/`)
  check(idx, { 'index 200': (r) => r.status === 200 })
  if (data.asset) {
    const a = http.get(`${BASE}${data.asset}`)
    check(a, {
      'asset 200': (r) => r.status === 200,
      'asset cached immutable': (r) => (r.headers['Cache-Control'] || '').includes('immutable'),
    })
  }
  // a client-router deep link → SPA fallback to index.html
  const spa = http.get(`${BASE}/tools/prompt-library`)
  check(spa, { 'spa 200': (r) => r.status === 200 })
}
