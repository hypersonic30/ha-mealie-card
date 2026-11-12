# Mealie Hub Card

A Home Assistant Lovelace card for browsing and importing recipes, backed by
a self-hosted [Mealie](https://mealie.io) instance.

Requires the companion
[Mealie Hub integration](https://github.com/hypersonic30/ha-mealie-integration):
the card only ever talks to Home Assistant's own API, never directly to
Mealie or Social-to-Mealie — no Mealie login, no cross-origin cookies to
lose in the Companion app.

## Tabs

- **Bibliothek** — a grid of recipe tiles (image + name, same height
  regardless of how long the name is); tap one to open a near-fullscreen
  detail sheet with ingredients, steps, and tags. Filter by tag with the
  chips above the grid. Add/remove tags right in the detail sheet.
- **Einkaufsliste** — Mealie's shopping list (first one on the household),
  with checkboxes to tick off what you already have. The detail sheet has an
  "Zur Einkaufsliste hinzufügen" button to add a recipe's ingredients to it;
  if the recipe has a servings count, a stepper lets you scale that count up
  or down first (e.g. cooking for 6 instead of the stored 4 scales every
  quantity by 1.5x).
- **Importieren** — paste a link. Instagram/TikTok/Facebook/Pinterest links
  and `youtube.com/shorts/` go to Social-to-Mealie (if configured); every
  other link goes through Mealie's own scraper + AI-provider fallback.
  Pasting another link while one is still running queues it instead of
  racing it — you see the current job, the queue order, and recent results.

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

v0.3.0 — recipe browsing, import, and tagging confirmed working against a
real Mealie + Ollama + Social-to-Mealie stack. The shopping list tab is new
and not yet confirmed live — see the companion integration's README for why.
