# Stripe Node starter

One-time payments with Stripe Checkout (US / USD), plus a signature-verified webhook that handles fulfillment.

## Setup

1. Create a Stripe sandbox and a **restricted key** (`rk_test_...`) with write access to Checkout Sessions.
   No account yet? `npm i -g @stripe/cli` then `stripe sandbox create`.
2. `cp .env.example .env` and put your key in `STRIPE_API_KEY`.
3. `npm install`
4. In one terminal: `stripe login` (once), then `npm run listen`. Copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.
5. In another terminal: `npm start`, then open http://localhost:4242.
6. Pay with test card `4242 4242 4242 4242`, any future expiry, any CVC. The server logs `Fulfilling cs_test_...`.

## How it works

- `POST /create-checkout-session`: creates a Checkout Session from the server-side `PRODUCTS` catalog and returns its URL.
- `POST /webhook`: verifies the Stripe signature, then fulfills on `checkout.session.completed` and
  `checkout.session.async_payment_succeeded` once `payment_status` is `paid`.
- The success page is display-only. Customers can close the tab before it loads, so it never fulfills.

## Before going live

- Replace the in-memory `fulfilled` Set in `server.js` with a database record (idempotency).
- Put your real fulfillment in `fulfillOrder()`.
- Use a live restricted key, register a live webhook endpoint in the Dashboard, and set `DOMAIN`.
- Only enable `automatic_tax` after adding a state tax registration in Stripe Tax.
- Work through https://docs.stripe.com/get-started/checklist/go-live.md
