# Mealie Hub Card

A Home Assistant Lovelace card for browsing and importing recipes, backed by
a self-hosted [Mealie](https://mealie.io) instance.

Requires the companion
[Mealie Hub integration](https://github.com/hypersonic30/ha-mealie-integration):
the card only ever talks to Home Assistant's own API, never directly to
Mealie or Social-to-Mealie — no Mealie login, no cross-origin cookies to
lose in the Companion app.

## Tabs

- **Bibliothek** — a grid of recipe tiles (image + name); tap one to expand
  ingredients and steps right underneath it.
- **Importieren** — paste a link. Instagram/TikTok/Facebook/Pinterest links
  and `youtube.com/shorts/` go to Social-to-Mealie (if configured); every
  other link goes through Mealie's own scraper + AI-provider fallback.

## Setup

1. Install and configure the
   [Mealie Hub integration](https://github.com/hypersonic30/ha-mealie-integration)
   first.
2. Install this card via HACS (custom repository) and add it to a dashboard:
   ```yaml
   type: custom:mealie-hub-card
   title: Rezepte
   ```

## Status

v0.1.0 — initial scaffold, tested against a stubbed Home Assistant
(`tests/browser`), not yet against a real Mealie instance.
