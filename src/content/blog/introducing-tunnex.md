---
title: 'Introducing Tunnex'
description: 'A self-hosted Zero Trust VPN built on one premise: your network should never depend on ours. Here is what we are building, and where it stands today.'
pubDate: 2026-07-12
author: 'Pawan Gupta'
tags: ['announcements']
draft: true
---

Every VPN vendor asks for the same thing: trust. Trust their relays, trust
their control plane, trust that their outage isn't your outage. We think the
better answer is to need less of it.

**Connect everything. Trust nothing.** That includes us.

## What Tunnex is

Tunnex is a self-hosted Zero Trust VPN. WireGuard® moves your packets —
modern cryptography, wire-speed performance, no proprietary protocol in the
middle. On top of it, Tunnex adds the things a team actually needs to run a
private network: single sign-on, access policies, audit logs, and a control
plane to manage it all.

The part that makes it different is _where it runs_. Everything that moves or
protects your data — control plane, gateways, clients — runs on
infrastructure you own. It runs on any VPS with Docker and a public address,
and the network is yours.

## The trust-domain boundary

Most networking products blur the line between your infrastructure and the
vendor's. We drew it deliberately, and we keep it sharp:

- **Your trust domain**: your control plane, your gateways, your clients.
  Your traffic, your WireGuard keys, your configs, your users, your logs.
  None of it ever leaves your infrastructure — not by policy, by
  architecture.
- **Our trust domain**: a hosted service that holds exactly two kinds of
  records — billing and licenses. It is never in your traffic path.

The consequence is the property we care most about: **your VPN keeps running
even if tunnex.io goes dark.** License checks happen offline, inside your
deployment. There is no phone-home, and no license server in your critical
path — and there never will be. That's a design constraint, not a roadmap
item.

## Open core, honestly drawn

The self-hosted core is free — unlimited devices, no seat math. It includes
the control plane, gateways, desktop and CLI clients, local authentication,
and the WireGuard data plane. That's not a crippled demo; it's a working
private network.

Enterprise is for teams that need identity, policy, and scale: SSO with
Google and Microsoft Entra, Zero Trust access policies, multi-tenant
organizations, a Kubernetes operator, and priority support. When an
Enterprise license lapses, features fall back to the Open tier and the VPN
keeps running. The line between free and paid should never hold your packets
hostage.

## Where we are today

Honest status: Tunnex is in the run-up to beta. The site is live, and the
[14-day Enterprise trial](/trial/) is open for requests. One trial per
company domain, bound to a verified work email; license keys go out the
moment the beta opens. Your trial clock starts when your key is issued, not
when you sign up, so there is no cost to being early.

If you'd rather just watch: the [waitlist](/download/) gets an email the
moment downloads open — nothing else.

We'll publish the engineering behind the bigger claims here, starting today
with [why our license keys work offline](/blog/why-offline-license-keys/);
the fail-closed kill-switch design is next in line. If any of this is the
kind of problem you think about, we'd like to hear from you:
[sales@tunnex.io](mailto:sales@tunnex.io) reaches a human.
