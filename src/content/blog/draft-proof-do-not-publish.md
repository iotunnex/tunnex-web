---
title: 'DRAFT PROOF — must never appear in any build output'
description: 'Permanent draft used as evidence that draft: true posts are absent from pages, tag pages, and the RSS feed.'
pubDate: 2026-07-12
author: 'Tunnex Team'
tags: ['draft-proof-tag-must-not-exist']
draft: true
---

If you can read this anywhere on the deployed site or in /blog/rss.xml, the
draft filter is broken. The unique string for grepping build output is:
DRAFT_LEAK_CANARY_S3B1.
