---
title: Architecture
description: Control plane, gateways, clients — and the trust boundary.
sidebar:
  order: 2
---

:::note[Stub]
Placeholder — full architecture reference lands with the beta. The security
posture is summarized on the [security page](/security/).
:::

## Components

- **Control plane** — self-hosted; issues configuration and policy.
- **Gateways** — WireGuard termination points inside your network.
- **Clients** — desktop apps and CLI, enrolled via your identity provider.

## Trust boundary

_To be written: what runs where, what the hosted service holds (billing and
license records only), offline license verification._
