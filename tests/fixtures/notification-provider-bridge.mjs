// Test process only. Never loaded by the shipped worker command or Docker image.
import { GoogleAuth } from 'google-auth-library';
import pg from 'pg';
const origin = new URL(process.env.H2_FAKE_PROVIDER_URL);
if (origin.hostname !== '127.0.0.1') throw new Error('Loopback mock provider required');
GoogleAuth.prototype.getClient = async () => ({getRequestHeaders: async () => ({authorization: 'Bearer synthetic-access-token'})});
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(String(input));
  if (url.hostname === 'fcm.googleapis.com') return originalFetch(`${origin.origin}/fcm${url.pathname}`, options);
  if (url.origin !== origin.origin) throw new Error('Test forbids non-mock provider traffic');
  return originalFetch(input, options);
};

// Observe an actual committed claim, then let the test revoke rights before the worker proceeds.
const { Client } = pg;
const originalQuery = Client.prototype.query;
Client.prototype.query = function (...args) {
  const result = originalQuery.apply(this, args);
  const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
  if (sql?.includes('FROM notif_queue_claim(') && result?.then) {
    return result.then(async rows => {
      const response = await originalFetch(`${origin.origin}/claimed`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify(rows.rows.map(row => row.id)),
      });
      if (!response.ok) throw new Error('Mock claim barrier failed');
      return rows;
    });
  }
  return result;
};
