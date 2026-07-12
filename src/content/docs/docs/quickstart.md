---
title: Quickstart
description: Install the Tunnex server and connect your first device.
sidebar:
  order: 1
---

:::note[Page in progress]
Placeholder — the final quickstart is a two-question install (network name and
admin email) followed by first-device enrollment. Content lands with the beta.
:::

## Prerequisites

Any VPS with Docker and a public address. The install script is released by the
platform repository — this site only points at it, so the script you run is the
one that shipped.

## Install the server

```sh
curl -fsSL https://get.tunnex.io | sh
```

The installer asks two questions and starts the control plane.

## Prefer to verify first?

Download the script, check its checksum against the release, read it, then run it:

```sh
curl -fsSLO https://get.tunnex.io/install.sh
sha256sum -c install.sh.sha256   # checksum published with each release
less install.sh
sh install.sh
```

## Connect your first device

_To be written: download a client, sign in, verify the tunnel._
