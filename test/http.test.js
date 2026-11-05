import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, RateGate, retryTime, abortableWait } from '../src/core/http.js';

const url = 'https://data.csu.gov.cz/api/katalog/v1/sady';
function harness(fetcher, options = {}) {
  let time = 100000;
  const delays = [],
    events = [];
  const now = () => time;
  const wait = async (ms, signal) => {
    if (signal?.aborted) throw new DOMException('abort', 'AbortError');
    delays.push(ms);
    time += ms;
  };
  const gate = new RateGate({ now, wait, ...options });
  const client = new ApiClient({
    fetcher,
    gate,
    now,
    wait,
    random: () => 0,
    onEvent: (event) => events.push(event),
  });
  return { client, gate, now, delays, events };
}

test('Retry-After supports seconds, HTTP dates, clock skew and invalid headers', () => {
  assert.equal(retryTime('120', 1000), 121000);
  assert.equal(
    retryTime('Wed, 04 Nov 2026 10:02:00 GMT', 1000, 'Wed, 04 Nov 2026 10:00:00 GMT'),
    121000,
  );
  assert.equal(retryTime('nonsense', 1000), 0);
  assert.equal(retryTime('', 1000), 0);
  assert.equal(retryTime('-1', 1000), 0);
});

test('one queue serializes requests, enforces spacing and a rolling minute quota', async () => {
  const starts = [];
  let active = 0,
    peak = 0;
  let h;
  h = harness(
    async (_url, options) => {
      assert.equal(options.headers['Accept-Language'], 'cs');
      starts.push(h.now());
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
      return new Response('{}');
    },
    { limit: 3, spacing: 1200 },
  );
  await Promise.all(Array.from({ length: 5 }, (_, index) => h.client.request(`${url}?n=${index}`)));
  assert.equal(peak, 1);
  assert.deepEqual(starts, [100000, 101200, 102400, 160000, 161200]);
});

test('quota reservations coordinate two independent tabs under a shared Web Lock', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  let tail = Promise.resolve(),
    time = 10000;
  const locks = {
    request: (_, fn) => {
      const result = tail.then(fn);
      tail = result.catch(() => {});
      return result;
    },
  };
  const config = {
    storage,
    locks,
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
    spacing: 1200,
  };
  const one = new RateGate(config),
    two = new RateGate(config);
  await Promise.all([one.claim(), two.claim()]);
  assert.equal(JSON.parse([...values.values()][0]).starts.length, 2);
  assert(time >= 11200);
  await one.pause(time + 90000, 'provider');
  assert.equal(two.read().reason, 'provider');
});

test('the transfer Web Lock holds across the entire response stream for two tabs', async () => {
  let lockTail = Promise.resolve(),
    active = 0,
    peak = 0;
  const locks = {
    request(name, options, callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      }
      const operation = lockTail.then(() => {
        if (options.signal?.aborted) throw new DOMException('abort', 'AbortError');
        return callback();
      });
      lockTail = operation.catch(() => {});
      return operation;
    },
  };
  // Use separate lock queues for reservation and transfer to model Web Locks.
  const queues = new Map();
  locks.request = (name, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    const operation = (queues.get(name) || Promise.resolve()).then(() => {
      if (options.signal?.aborted) throw new DOMException('abort', 'AbortError');
      return callback();
    });
    queues.set(
      name,
      operation.catch(() => {}),
    );
    return operation;
  };
  const fetcher = async () =>
    new Response(
      new ReadableStream({
        async start(controller) {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          controller.enqueue(new Uint8Array([1]));
          controller.close();
          active--;
        },
      }),
    );
  const one = harness(fetcher, { locks }),
    two = harness(fetcher, { locks });
  await Promise.all([one.client.request(url), two.client.request(url + '?second=1')]);
  assert.equal(peak, 1);
});

test('429 honors Retry-After, persists cooldown, and does not loop on the API', async () => {
  let calls = 0;
  const h = harness(async () =>
    ++calls === 1
      ? new Response('limited', { status: 429, headers: { 'Retry-After': '120' } })
      : new Response('{}'),
  );
  await assert.rejects(
    h.client.request(url),
    (error) => error.status === 429 && error.retryAt === 220000,
  );
  assert.equal(calls, 1);
  await h.client.request(url);
  assert.equal(calls, 2);
  assert(h.delays.includes(120000));
  assert.equal(h.client.log[1].status, 429);
});

test('403 pauses all endpoints and 400/404 are never retried', async () => {
  for (const status of [400, 401, 403, 404, 413]) {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      return new Response('', { status });
    });
    await assert.rejects(h.client.request(url), (error) => error.status === status);
    assert.equal(calls, 1);
    assert.equal(h.gate.read().pauseUntil, status === 403 ? 700000 : 0);
  }
});

test('503 Retry-After uses bounded retries and succeeds after waiting', async () => {
  let calls = 0;
  const h = harness(async () =>
    ++calls < 3
      ? new Response('', { status: 503, headers: { 'Retry-After': '2' } })
      : new Response('{"ok":true}'),
  );
  const result = await h.client.request(url);
  assert.equal(calls, 3);
  assert.equal(await result.blob.text(), '{"ok":true}');
  assert(h.delays.reduce((a, b) => a + b, 0) >= 5000);
  assert.deepEqual(
    h.client.log.map((item) => item.status),
    [200, 503, 503],
  );
});

test('permanent 500 stops after initial attempt and two retries', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return new Response('', { status: 500 });
  });
  await assert.rejects(h.client.request(url), (error) => error.status === 500);
  assert.equal(calls, 3);
});

test('an exposed exhausted rate budget delays the next request even after HTTP 200', async () => {
  let calls = 0;
  const h = harness(async () =>
    ++calls === 1
      ? new Response('{}', {
          headers: { 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': '200' },
        })
      : new Response('{}'),
  );
  await h.client.request(url);
  assert.equal(h.gate.read().pauseUntil, 200000);
  await h.client.request(url + '?next=1');
  assert(h.now() >= 200000);
});

test('identical requests deduplicate; canceling one subscriber retains the other', async () => {
  let calls = 0,
    release;
  const h = harness(async () => {
    calls++;
    await new Promise((resolve) => {
      release = resolve;
    });
    return new Response('{}');
  });
  const controller = new AbortController();
  const one = h.client.request(url, { signal: controller.signal });
  const rejection = assert.rejects(one, { name: 'AbortError' });
  const two = h.client.request(url);
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  release();
  await rejection;
  assert.equal((await two).status, 200);
  assert.equal(calls, 1);
});

test('canceling a queued request consumes no extra quota and same-key retry is usable', async () => {
  let release,
    calls = 0;
  const h = harness(async () => {
    calls++;
    if (calls === 1)
      await new Promise((resolve) => {
        release = resolve;
      });
    return new Response('{}');
  });
  const first = h.client.request(url);
  await new Promise((resolve) => setImmediate(resolve));
  const controller = new AbortController();
  const queued = h.client.request(url + '?queued=1', { signal: controller.signal });
  const rejection = assert.rejects(queued, { name: 'AbortError' });
  controller.abort();
  const retry = h.client.request(url + '?queued=1');
  release();
  await Promise.all([first, rejection, retry]);
  assert.equal(calls, 2);
  assert.equal(h.gate.state.starts.length, 2);
});

test('network/CORS failures are tracked and not blindly retried', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(h.client.request(url), /Failed to fetch/);
  assert.equal(calls, 1);
  assert.equal(h.client.log[0].status, 0);
});

test('streams report real byte progress; compressed content-length is not a false total', async () => {
  const encoder = new TextEncoder();
  const h = harness(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('žluťoučký'));
            controller.enqueue(encoder.encode(' text'));
            controller.close();
          },
        }),
        { headers: { 'Content-Encoding': 'gzip', 'Content-Length': '5' } },
      ),
  );
  const result = await h.client.request(url);
  const events = h.events.filter((event) => event.phase === 'receiving');
  assert.equal(events.length, 2);
  assert.equal(events[0].total, 0);
  assert(events[1].loaded > events[0].loaded);
  assert.equal(await result.blob.text(), 'žluťoučký text');
});

test('declared and streaming oversize responses are stopped', async () => {
  for (const declared of [false, true]) {
    const h = harness(
      async () => new Response('abcdef', { headers: declared ? { 'Content-Length': '6' } : {} }),
    );
    await assert.rejects(h.client.request(url, { maxBytes: 3 }), /velikost/);
  }
});

test('API allowlist rejects insecure hosts, credentials and mutation verbs', async () => {
  const h = harness(() => {
    throw new Error('must not fetch');
  });
  for (const target of [
    'http://data.csu.gov.cz/api',
    'https://evil.invalid/',
    'https://user:pass@data.csu.gov.cz/',
  ])
    await assert.rejects(h.client.request(target), /endpoint/);
  await assert.rejects(h.client.request(url, { method: 'DELETE' }), /endpoint/);
});

test('abortable wait and transfer timeout release listeners and queue', async () => {
  const controller = new AbortController();
  const waiting = abortableWait(60000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  const h = harness(
    (_, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError')), {
          once: true,
        }),
      ),
  );
  h.client.timeout = 10;
  await assert.rejects(h.client.request(url), /časový limit/);
  assert.equal(h.client.inFlight.size, 0);
});
