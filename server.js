import express from 'express';
import Stripe from 'stripe';

const { STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
const PORT = Number(process.env.PORT ?? 4242);
const DOMAIN = process.env.DOMAIN ?? `http://localhost:${PORT}`;

if (!STRIPE_API_KEY || !STRIPE_WEBHOOK_SECRET) {
  console.error('Missing STRIPE_API_KEY or STRIPE_WEBHOOK_SECRET. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Client instance (not the deprecated global key), pinned to the API version this code was written against.
const stripe = new Stripe(STRIPE_API_KEY, { apiVersion: '2026-08-26.dahlia' });

// The catalog lives on the server so the browser can never choose its own price.
// Replace with your own products, or with Price IDs created in the Dashboard.
const PRODUCTS = {
  starter: { name: 'Starter product', unit_amount: 2000, currency: 'usd' }, // $20.00
};

// Tags sessions from this flow so they can be compared in the Dashboard.
const INTEGRATION_ID = 'node-starter-checkout-qvmrtzka';

const app = express();

// Webhooks need the raw body for signature verification, so this route is registered
// before express.json() and uses express.raw().
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        // Card payments are 'paid' on completed; delayed methods (e.g. ACH) arrive 'unpaid'
        // and are fulfilled later by async_payment_succeeded.
        if (session.payment_status === 'paid') await fulfillOrder(session.id);
        break;
      }
      case 'checkout.session.async_payment_failed':
        console.warn(`Delayed payment failed for session ${event.data.object.id}`);
        break;
      default:
        break;
    }
    res.json({ received: true });
  } catch (err) {
    // A non-2xx response makes Stripe retry the event later.
    console.error(`Webhook handler error for ${event.id}: ${err.message}`);
    res.status(500).end();
  }
});

app.use(express.json());
app.use(express.static('public'));

app.post('/create-checkout-session', async (req, res) => {
  const product = PRODUCTS[req.body?.productId ?? 'starter'];
  if (!product) return res.status(400).json({ error: 'Unknown product' });

  try {
    // No payment_method_types: Stripe shows eligible methods configured in the Dashboard.
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: product.currency,
            product_data: { name: product.name },
            unit_amount: product.unit_amount,
          },
          quantity: 1,
        },
      ],
      success_url: `${DOMAIN}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${DOMAIN}/cancel.html`,
      integration_identifier: INTEGRATION_ID,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(`Checkout Session creation failed: ${err.message}`);
    res.status(500).json({ error: 'Could not start checkout' });
  }
});

// Stripe can deliver an event more than once, and both webhook events above can fire for
// the same session, so fulfillment must be idempotent. This in-memory Set is for local
// development only: persist fulfilled session IDs in your database in production.
const fulfilled = new Set();

async function fulfillOrder(sessionId) {
  if (fulfilled.has(sessionId)) return;

  // Re-fetch rather than trusting the event payload, and expand what fulfillment needs.
  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items'] });
  if (session.payment_status !== 'paid') return;

  // TODO: grant access, ship goods, send a receipt, etc.
  console.log(
    `Fulfilling ${sessionId}: ${session.line_items.data.map((i) => `${i.quantity} x ${i.description}`).join(', ')} ` +
      `for ${session.customer_details?.email ?? 'unknown email'} (${session.amount_total / 100} ${session.currency.toUpperCase()})`,
  );
  fulfilled.add(sessionId);
}

app.listen(PORT, () => console.log(`Listening on ${DOMAIN}`));
