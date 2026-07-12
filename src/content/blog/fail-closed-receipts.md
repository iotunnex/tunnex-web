---
title: 'Designed to fail closed: the receipts'
description: 'Our security page hedges: the kill-switch is "designed to" fail closed. This is the engineering behind that hedge — kernel-resident enforcement, a stranding bug we found the hard way, a packet-capture proof, and a Windows gap we are fixing in the open.'
pubDate: 2026-07-12
author: 'Tunnex Team'
tags: ['security', 'engineering']
draft: true
---

Our [security page](/security/) says the desktop clients are _designed to_
fail closed — and admits we chose those words deliberately, because we'd
rather under-promise than oversell a security boundary. This post is the
engineering behind that hedge: how the kill-switch actually works, the bug
that stranded a test machine, the trade we accepted to fix it, and the
packet capture that finally earned the claim.

## Fail-open is a design bug

A VPN that leaks when it crashes leaks exactly the traffic you bought it to
protect — at the worst possible moment, silently, while everything looks
fine. If the tunnel drops and packets fall back to the open network, the
kill-switch didn't fail gracefully; the product failed at the one job that
justified its existence. So we treat fail-open as a design bug, not a
degraded mode.

## Cleanup code can't be the answer

The naive kill-switch is code that runs when things go wrong: catch the
crash, block the traffic. That can't work, and it's worth being precise
about why.

The app a user interacts with is unprivileged; the privileged helper that
manages the tunnel can be killed with `kill -9` — which runs no cleanup
handlers, no signal hooks, no last-breath code of any kind. Any design where
fail-closed depends on _something executing at death_ has a hole exactly
where the guarantee matters most.

So we inverted the requirement: **fail-closed must require no live code to
act.**

## Death as enforcement

At tunnel-up, before traffic flows, the helper arranges kernel-resident
state that blocks cleartext egress — and then that state simply _persists_,
however the process exits. On macOS this is a pf (packet filter) anchor
installed via pfctl: block all outbound except traffic to the WireGuard®
endpoint and traffic through the tunnel interface, for IPv4 and IPv6 both.
pf rules live in the kernel; they do not care whether our helper is running.

Only a graceful disconnect removes the block. Death itself is the
enforcement.

The details are boring on purpose: pf is enabled with a reference-counted
token (released on graceful down — we never globally disable a firewall the
user might be running for other reasons); loopback is exempt; DHCP and NDP
are deliberately passed so a long session doesn't lose its lease mid-day — a
local-segment spoofing risk we judged out of scope for an _egress_
kill-switch, and we'd rather state that judgment than hide it.

Routing follows the WireGuard standard for full-tunnel: split-default routes
(`0.0.0.0/1` and `128.0.0.0/1`, plus the IPv6 halves) that are more specific
than the physical default, so they take precedence without destroying it.
On teardown — graceful or not — the halves vanish with the tunnel interface
and the physical default resurfaces on its own.

## The bug that stranded a machine

The first live test found the hole in our own logic. "Death is enforcement,
only graceful down removes the block" has a failure mode: a crashed helper
leaves the kernel block installed with nothing left alive to release it. The
machine stayed dark until a reboot. The invariant worked perfectly — that
was the problem.

The fix is what we now call _bounded_ fail-closed, three mechanisms:

1. **Startup self-heal** — a restarting helper flushes any stale block
   before serving, so the watchdog's restart un-strands the machine
   automatically.
2. **A dead-man timeout** — if the owning app stops heartbeating for about
   ninety seconds, the still-live helper releases the block.
3. **Graceful disconnect** — the normal path.

That means naming a trade, plainly: after an unrecovered crash, the maximum
cleartext-leak window is the dead-man interval. We accepted it because the
alternative is worse — an unbounded block that bricks the host protects
nothing on a machine whose VPN is already down, and trains users to disable
the kill-switch entirely.

## The proof

Claims like these are cheap, so we tested it the unfriendly way, on real
hardware: full-tunnel up, `kill -9` the helper, packet capture running on
the physical interface across the dead window while ~30 pings fired over
IPv4 and IPv6.

**Zero cleartext packets left the machine.** The helper was gone; nothing
but the pre-arranged kernel state was enforcing the block. And the bonus
finding: the watchdog restart plus startup self-heal recovered the host
automatically — no manual intervention, no reboot.

## The Windows gap, disclosed

Applying the same proof standard to Windows found a real gap — which is the
point of having a proof standard.

Windows uses WFP (Windows Filtering Platform), the same mechanism the
official WireGuard client uses. But wireguard-windows opens its WFP session
with `FWPM_SESSION_FLAG_DYNAMIC` — filters that auto-delete when the process
exits. Hard-kill the helper and the block removes _itself_; the traffic
leak is packet-capture-confirmed on a real Windows box. macOS pf state is
persistent; dynamic-session WFP is not.

The fix is in progress: a non-dynamic WFP session with persistent filters, a
fixed provider GUID, and an explicit enumerate-and-delete cleanup — the
dynamic session did all cleanup for free, so removing it means owning
cleanup deliberately — inheriting the same bounded model: startup
stale-sweep, dead-man timeout, reboot as the recovery of last resort. Until
that ships and passes the same packet-capture test, the client gates
full-tunnel on Windows rather than offering a kill-switch we can't stand
behind.

## Why "designed to"

This is why the security page hedges. A kill-switch is a per-platform,
adversarial engineering problem, and the honest description of our state is:
proven on macOS with packet captures, being fixed properly on Windows, and
tested by assuming our own code will die at the worst moment. When the
Windows work lands, the receipts will be published the same way.

Found a hole in this reasoning? We'd genuinely like to know:
[security@tunnex.io](mailto:security@tunnex.io) — a human reads every
report.
