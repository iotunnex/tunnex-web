---
title: 'Why offline license keys'
description: 'Tunnex licenses verify offline against a public key in the binary — no phone-home, no license server in your critical path. The reasoning, and the trade we accepted to get there.'
pubDate: 2026-07-12
author: 'Tunnex Team'
tags: ['security', 'licensing']
draft: true
---

There's a quiet dependency hiding in most commercial software: the license
check. It looks harmless — a token refresh here, an activation ping there —
until the vendor has an outage, or gets acquired, or sunsets the product, and
suddenly a network you own stops working because a server you don't own
stopped answering.

For a VPN, we think that's disqualifying. So Tunnex licenses work offline,
completely.

## How it works

Every Tunnex binary ships with a public key. Your license is a signed
document: the claims — who the license is for, what tier, and for how long —
signed with the matching private key, which never leaves us. Your deployment
verifies the signature locally with Ed25519 and reads the claims. That's the
whole protocol.

What this buys you:

- **No phone-home.** Verification is a local computation. Nothing about your
  deployment — not usage, not topology, not even "we're still here" — is
  reported anywhere as a condition of running.
- **No license server in your critical path.** There is no activation
  endpoint to reach and no dependency on our uptime. Our hosted service holds
  billing and license records, and it is never between your packets and where
  they're going.
- **Air-gapped deployments, fully supported.** A license key is a string. If
  you can carry a string across an air gap, you can license a deployment
  there. No exemption process, no "call sales for offline activation" —
  offline is the only mode.

## The trade we accepted

Fully offline verification has a real cost, and we'd rather name it than hide
it: a key that never checks in can't be revoked remotely. There's no kill
message we could send — by design, there's no channel to send it on.

Revocability has to come from somewhere, so it comes from time. License keys
carry a validity window and are renewed rather than everlasting. A key that
should no longer exist simply ages out; a healthy subscription renews without
ceremony. That's the trade in one sentence: **we gave up remote revocation
and bought it back with expiry.**

We think it's the right side of the trade for infrastructure software. The
alternative — remote revocation — means a vendor holds a switch that can turn
your network off. Nobody should hold that switch for your network, including
us.

## What happens when a key expires

The part most licensing schemes get wrong: expiry is a billing event, not an
outage.

When an Enterprise license expires, there's a grace period with warnings,
then Enterprise features — SSO, Zero Trust policies, multi-org management —
lapse to the free Open tier. **The VPN keeps running.** License state never
touches the data plane; your tunnels don't know or care what tier you're on.
Renewing is pasting a new key — no reinstall, no migration, features unlock
in place.

That property isn't an accident of implementation, it's the point: the
boundary between free and paid is drawn through _management features_, never
through _your packets_.

## The shape of the argument

Self-hosting is a sovereignty decision. It would be strange to make that
decision and then accept a licensing scheme that quietly hands operational
control back to the vendor. Offline keys close the loop: the software runs on
your machines, holds your keys, keeps your logs — and now proves its license
without asking anyone's permission, ours included.

The [security model](/security/) page covers the wider architecture — what we
cannot see, and why. And if your deployment has constraints we haven't
covered, [sales@tunnex.io](mailto:sales@tunnex.io) reaches a human who can
talk through it.
