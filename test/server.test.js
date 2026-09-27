import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import Stripe from 'stripe';

// These tests never reach the Stripe API: they cover routing, input validation and
// webhook signature checks, which run locally. Dummy credentials are fine.
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_SECRET = 'whsec_test_ci';
const stripe = new Stripe('sk_test_dummy');

let server;

before(async () => {
  server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, STRIPE_API_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 10_000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes('Listening on')) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', onData);
    server.on('exit', (code) => reject(new Error(`Server exited with ${code}:\n${output}`)));
  });
});

after(() => server?.kill());

function postWebhook(event, signature) {
  const body = JSON.stringify(event);
  return fetch(`${BASE}/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': signature ?? stripe.webhooks.generateTestHeaderString({ payload: body, secret: WEBHOOK_SECRET }),
    },
    body,
  });
}

const sessionEvent = (type, payment_status) => ({
  id: 'evt_test',
  type,
  data: { object: { id: 'cs_test_123', payment_status } },
});

test('serves the checkout page', async () => {
  const res = await fetch(`${BASE}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Checkout/);
});

test('rejects webhooks with an invalid signature', async () => {
  const res = await postWebhook(sessionEvent('checkout.session.completed', 'paid'), 't=1,v1=bad');
  assert.equal(res.status, 400);
});

test('acknowledges a signed but unpaid session without fulfilling', async () => {
  const res = await postWebhook(sessionEvent('checkout.session.completed', 'unpaid'));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { received: true });
});

test('acknowledges signed events it does not handle', async () => {
  const res = await postWebhook({ id: 'evt_other', type: 'customer.created', data: { object: {} } });
  assert.equal(res.status, 200);
});

test('rejects unknown products before calling Stripe', async () => {
  const res = await fetch(`${BASE}/create-checkout-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ productId: 'does-not-exist' }),
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Unknown product' });
});
