/*!
 * Mealie Hub Card — a Home Assistant Lovelace card for browsing and importing
 * recipes, backed by a self-hosted Mealie instance (and optionally
 * Social-to-Mealie for Instagram/TikTok recipe videos).
 *
 * Requires the companion "Mealie Hub" integration
 * (https://github.com/hypersonic30/ha-mealie-integration): it proxies every
 * request, so no Mealie API key ever reaches the browser and no cross-origin
 * login is needed — unlike embedding Mealie's own web UI in an iframe, this
 * also works reliably in the Home Assistant Companion app.
 *
 * Same glass design language as the Books/Manga cards.
 *
 * License: MIT
 */
"use strict";

const CARD_VERSION = "0.3.0";
const CARD_TAG = "mealie-hub-card";
const EDITOR_TAG = "mealie-hub-card-editor";

const DEFAULT_CONFIG = {
  title: "Rezepte",
  default_tab: "library",
};

const TABS = [
  { key: "library", label: "Bibliothek", icon: "mdi:book-open-variant" },
  { key: "shopping", label: "Einkaufsliste", icon: "mdi:cart-outline" },
  { key: "import", label: "Importieren", icon: "mdi:link-plus" },
];

const IMPORT_HISTORY_MAX = 10;

const SIGN_EXPIRY_SECONDS = 24 * 3600;

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Mealie's own API returns structured ingredient objects (quantity/unit/food/note),
// not plain strings — `display` is Mealie's own pre-rendered text for exactly this.
function ingredientText(ing) {
  if (typeof ing === "string") return ing;
  if (ing && typeof ing.display === "string" && ing.display) return ing.display;
  if (ing && typeof ing.note === "string" && ing.note) return ing.note;
  return "";
}

function errMessage(err) {
  const body = err && err.body;
  if (body && typeof body.error === "string") return body.error;
  if (err && typeof err.message === "string") return err.message;
  return "Unbekannter Fehler";
}

// ─────────────────────────────────────────────────────────────────────────
// Styles — same glass language as the Books/Manga cards, phone-first sizing
// ─────────────────────────────────────────────────────────────────────────

const STYLE = `
<style>
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  :host {
    display: block;
    --mc-radius-lg: 26px;
    --mc-radius-md: 16px;
    --mc-radius-sm: 10px;
    --mc-blur: 26px;
    --mc-accent-rgb: 10, 132, 255;
    --mc-accent: var(--primary-color, rgb(var(--mc-accent-rgb)));
    --mc-soft: rgba(128, 128, 128, 0.10);
    --mc-line: rgba(128, 128, 128, 0.18);
    font-family: var(--paper-font-body1_-_font-family, -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif);
  }
  ha-card {
    position: relative; overflow: hidden; border-radius: var(--mc-radius-lg);
    background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 55%, transparent);
    backdrop-filter: blur(var(--mc-blur)) saturate(160%);
    -webkit-backdrop-filter: blur(var(--mc-blur)) saturate(160%);
    border: 1px solid color-mix(in srgb, var(--divider-color, #8e8e93) 55%, transparent);
    box-shadow: 0 20px 45px rgba(0, 0, 0, 0.16), inset 0 1px 1px rgba(255, 255, 255, 0.12);
  }
  ha-card::before {
    content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.6;
    background: linear-gradient(120deg, rgba(255,255,255,0.30), rgba(255,255,255,0.05) 35%, transparent 60%);
  }
  .mc-root { position: relative; z-index: 1; display: flex; flex-direction: column; }
  .mc-header { display: flex; align-items: center; gap: 10px; padding: 18px 18px 6px; }
  .mc-title { flex: 1; font-size: 1.35em; font-weight: 700; letter-spacing: -0.01em; color: var(--primary-text-color); }
  .mc-error {
    display: flex; align-items: center; gap: 8px; margin: 10px 16px 0; padding: 10px 14px;
    border-radius: var(--mc-radius-sm); color: white; font-size: 0.9em;
    background: color-mix(in srgb, var(--error-color, #db4437) 85%, transparent);
  }
  .mc-error button { margin-left: auto; background: none; border: none; color: inherit; font-size: 1.1em; cursor: pointer; }

  .mc-nav { display: flex; gap: 4px; margin: 8px 16px 0; padding: 4px; border-radius: 999px;
    background: color-mix(in srgb, var(--primary-text-color) 6%, transparent); }
  .mc-nav-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 40px; border: none; border-radius: 999px; background: none; cursor: pointer;
    font-size: 0.9em; font-weight: 600; color: var(--secondary-text-color); }
  .mc-nav-btn ha-icon { --mdc-icon-size: 18px; }
  .mc-nav-btn.active { color: white; background: color-mix(in srgb, var(--mc-accent) 92%, transparent);
    box-shadow: 0 2px 8px rgba(var(--mc-accent-rgb), 0.4); }

  .mc-panel { padding: 14px 16px 18px; }
  .mc-empty, .mc-loading { padding: 26px 8px; text-align: center; color: var(--secondary-text-color); font-size: 0.92em; line-height: 1.5; }

  .mc-searchbar { display: flex; gap: 8px; margin: 0 0 14px; }
  .mc-searchbar input { flex: 1; min-width: 0; min-height: 44px; padding: 10px 16px; border-radius: 999px;
    font-size: 16px; color: var(--primary-text-color); background: var(--mc-soft); border: 1px solid var(--mc-line); }
  .mc-searchbar input:focus { outline: 2px solid color-mix(in srgb, var(--mc-accent) 60%, transparent); }

  .mc-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px;
    padding: 10px 18px; border: none; border-radius: 999px; cursor: pointer; font-size: 0.95em; font-weight: 600;
    color: white; background: color-mix(in srgb, var(--mc-accent) 92%, transparent);
    box-shadow: 0 2px 8px rgba(var(--mc-accent-rgb), 0.35); transition: transform 0.1s ease; }
  .mc-btn:active { transform: scale(0.96); }
  .mc-btn:disabled { opacity: 0.5; transform: none; box-shadow: none; cursor: default; }
  .mc-btn.secondary { color: var(--primary-text-color); background: var(--mc-soft); border: 1px solid var(--mc-line); box-shadow: none; }
  .mc-btn.round { width: 48px; min-width: 48px; padding: 0; }
  .mc-btn ha-icon { --mdc-icon-size: 22px; }
  .mc-btn.block { width: 100%; }

  /* Recipe grid — every tile is the same height regardless of name length */
  .mc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px 12px; }
  .mc-tile { cursor: pointer; min-width: 0; -webkit-tap-highlight-color: transparent; }
  .mc-cover { position: relative; aspect-ratio: 4 / 3; border-radius: var(--mc-radius-sm); overflow: hidden;
    background: var(--mc-soft); box-shadow: 0 6px 16px rgba(0,0,0,0.22); }
  .mc-cover img { position: absolute; inset: 0; z-index: 1; width: 100%; height: 100%; object-fit: cover; display: block; }
  .mc-cover .mc-cover-fallback { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    padding: 8px; text-align: center; font-size: 0.75em; color: var(--secondary-text-color); }
  .mc-tile-title { margin-top: 6px; font-size: 0.86em; font-weight: 600; line-height: 1.25; color: var(--primary-text-color);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  /* Dialog: native <dialog> + showModal() → top layer, near-fullscreen on phones */
  .mc-dialog { padding: 0; border: none; background: transparent; max-width: 100vw; max-height: 100dvh; color: var(--primary-text-color); }
  .mc-dialog::backdrop { background: rgba(0,0,0,0.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .mc-sheet { position: relative; width: min(720px, 100vw); height: min(900px, 100dvh); overflow: hidden; display: flex; flex-direction: column;
    border-radius: var(--mc-radius-lg); background: color-mix(in srgb, var(--card-background-color, #1c1c1e) 94%, transparent);
    box-shadow: 0 30px 60px rgba(0,0,0,0.45); }
  .mc-sheet-scroll { overflow-y: auto; padding: 18px 18px calc(18px + env(safe-area-inset-bottom)); }
  .mc-sheet-close { position: absolute; top: 10px; right: 10px; z-index: 3; }
  .mc-banner { position: absolute; left: 0; right: 0; top: 0; height: 240px; background-size: cover; background-position: center;
    filter: blur(28px) saturate(140%); opacity: 0.5; transform: scale(1.2);
    mask-image: linear-gradient(to bottom, black, transparent); -webkit-mask-image: linear-gradient(to bottom, black, transparent); }
  .mc-detail-cover { position: relative; z-index: 1; aspect-ratio: 16 / 9; border-radius: var(--mc-radius-md); overflow: hidden;
    background: var(--mc-soft); box-shadow: 0 6px 16px rgba(0,0,0,0.22); margin-bottom: 14px; }
  .mc-detail-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .mc-detail-title { position: relative; z-index: 1; font-size: 1.4em; font-weight: 700; color: var(--primary-text-color); margin-bottom: 10px; }
  .mc-detail h4, .mc-panel h4 { font-size: 0.8em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--secondary-text-color); margin: 18px 0 8px; }
  .mc-detail ul, .mc-detail ol { margin: 0; padding-left: 20px; line-height: 1.6; }

  .mc-import-row { display: flex; gap: 8px; }
  .mc-import-row input { flex: 1; min-height: 44px; padding: 10px 16px; border-radius: 999px; font-size: 16px;
    color: var(--primary-text-color); background: var(--mc-soft); border: 1px solid var(--mc-line); }
  .mc-hint { color: var(--secondary-text-color); font-size: 0.9em; margin-top: 10px; line-height: 1.5; }

  .mc-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; margin-bottom: 14px; scrollbar-width: none; }
  .mc-chip { flex: 0 0 auto; min-height: 34px; padding: 6px 14px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--mc-line); background: var(--mc-soft); color: var(--primary-text-color);
    font-size: 0.85em; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
  .mc-chip.active { background: color-mix(in srgb, var(--mc-accent) 90%, transparent); color: white; border-color: transparent; }
  .mc-chip.removable ha-icon { --mdc-icon-size: 14px; margin-left: 2px; }
  .mc-tag-add { display: flex; gap: 6px; margin-top: 6px; }
  .mc-tag-add input { flex: 1; min-height: 38px; padding: 6px 12px; border-radius: 999px; font-size: 0.9em;
    color: var(--primary-text-color); background: var(--mc-soft); border: 1px solid var(--mc-line); }

  /* Import tab: current job, queue, recent history */
  .mc-job { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--mc-radius-md);
    background: color-mix(in srgb, var(--mc-accent) 14%, transparent); border: 1px solid color-mix(in srgb, var(--mc-accent) 35%, transparent);
    margin-top: 12px; }
  .mc-job-url { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 0.9em; }
  .mc-job-time { color: var(--secondary-text-color); font-size: 0.85em; flex: 0 0 auto; }
  .mc-spinner { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--mc-line);
    border-top-color: var(--mc-accent); animation: mc-spin 0.8s linear infinite; flex: 0 0 auto; }
  @keyframes mc-spin { to { transform: rotate(360deg); } }
  .mc-queue { margin-top: 10px; }
  .mc-queue-item, .mc-history-item { display: flex; align-items: center; gap: 8px; padding: 6px 2px; font-size: 0.88em; }
  .mc-queue-item span, .mc-history-item span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mc-history-item.ok { color: var(--success-color, #43a047); }
  .mc-history-item.err { color: var(--error-color, #db4437); }
  .mc-queue-item button { background: none; border: none; color: var(--secondary-text-color); cursor: pointer; }

  /* Shopping list */
  .mc-shopping-list { display: flex; flex-direction: column; gap: 2px; }
  .mc-shopping-item { display: flex; align-items: center; gap: 10px; padding: 10px 4px; border-bottom: 1px solid var(--mc-line); cursor: pointer; }
  .mc-shopping-item input[type=checkbox] { width: 22px; height: 22px; flex: 0 0 auto; }
  .mc-shopping-item span { flex: 1; }
  .mc-shopping-item.checked span { color: var(--secondary-text-color); text-decoration: line-through; }
</style>
`;

class MealieHubCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULT_CONFIG };
    this._hass = null;
    this._connected = false;
    this._skeletonReady = false;
    this._activeTab = DEFAULT_CONFIG.default_tab;
    this._error = null;
    this._signed = new Map(); // path -> Promise<signed path>

    this._recipes = [];
    this._recipesLoaded = false;
    this._search = "";
    this._detailSlug = null;
    this._detail = null;
    this._showDetailHint = null;

    this._tags = []; // [{name, slug}] from /api/mealie_hub/tags
    this._tagFilter = null; // selected tag slug, or null for "Alle"
    this._tagDraft = ""; // the detail dialog's "add tag" input

    this._shoppingItems = [];
    this._shoppingLoaded = false;
    this._shoppingError = null;
    this._addToListBusy = false;

    this._importUrl = "";
    this._importRunning = null; // the URL currently being imported, or null
    this._importStartedAt = 0;
    this._importQueue = []; // URLs waiting their turn
    this._importHistory = []; // [{url, slug, error}], newest first
    this._importTickTimer = null;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._connected) {
      this._loadRecipes();
      this._loadTags();
    }
  }

  get hass() {
    return this._hass;
  }

  setConfig(config) {
    if (!config) throw new Error("Invalid configuration");
    this._config = { ...DEFAULT_CONFIG, ...config };
    if (!TABS.find((t) => t.key === this._activeTab)) this._activeTab = this._config.default_tab;
    if (this._connected) this._render();
  }

  _eventRoots() {
    return [this.shadowRoot, this._overlayRoot].filter(Boolean);
  }

  connectedCallback() {
    this._connected = true;
    clearTimeout(this._overlayCleanupTimer);
    this._ensureSkeleton();
    if (!this._overlay.isConnected) document.body.appendChild(this._overlay);
    for (const root of this._eventRoots()) {
      root.addEventListener("click", this._handleClick);
      root.addEventListener("input", this._handleInput);
      root.addEventListener("submit", this._handleSubmit);
    }
    this._render();
    if (this._hass) {
      this._loadRecipes();
      this._loadTags();
    }
  }

  disconnectedCallback() {
    this._connected = false;
    for (const root of this._eventRoots()) {
      root.removeEventListener("click", this._handleClick);
      root.removeEventListener("input", this._handleInput);
      root.removeEventListener("submit", this._handleSubmit);
    }
    // A re-insert (HA sections view, companion app) comes back within the same
    // frame; only a card that is really gone releases its overlay.
    clearTimeout(this._overlayCleanupTimer);
    this._overlayCleanupTimer = setTimeout(() => {
      if (!this._connected) this._overlay?.remove();
    }, 30000);
  }

  getCardSize() {
    return 6;
  }

  static getConfigElement() {
    return document.createElement(EDITOR_TAG);
  }

  static getStubConfig() {
    return { ...DEFAULT_CONFIG };
  }

  // ── Skeleton / overlay (dialog lives on <body>, not inside the card:
  // HA's dashboard layouts detach and re-insert card elements, and a modal
  // <dialog> moved like that silently drops out of the top layer) ───────

  _ensureSkeleton() {
    if (this._skeletonReady) return;
    this._skeletonReady = true;
    this.shadowRoot.innerHTML = `${STYLE}<ha-card><div class="mc-root" id="mc-shell"></div></ha-card>`;
    this._shellEl = this.shadowRoot.getElementById("mc-shell");

    this._overlay = document.createElement("div");
    this._overlay.className = "mealie-hub-card-overlay";
    const overlayRoot = this._overlay.attachShadow({ mode: "open" });
    overlayRoot.innerHTML = `${STYLE}<dialog class="mc-dialog" id="mc-detail"></dialog>`;
    this._overlayRoot = overlayRoot;
    document.body.appendChild(this._overlay);
    this._detailDialog = overlayRoot.getElementById("mc-detail");

    this._detailDialog.addEventListener("click", (ev) => {
      if (ev.target !== this._detailDialog) return;
      const r = this._detailDialog.getBoundingClientRect();
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      if (!inside) this._detailDialog.close();
    });
    this._detailDialog.addEventListener("close", () => {
      this._detailSlug = null;
      this._detail = null;
      this._render();
    });
  }

  // ── Networking ──────────────────────────────────────────────────────

  async _api(method, path, body) {
    try {
      return await this._hass.callApi(method, path, body);
    } catch (err) {
      if (err?.status === 401 && this._hass?.connection?.refreshAccessToken) {
        try {
          await this._hass.connection.refreshAccessToken();
        } catch (_) {
          /* retry with whatever token we have */
        }
        return this._hass.callApi(method, path, body);
      }
      throw err;
    }
  }

  // <img> can't send a bearer header, so recipe images get HA signed paths.
  _sign(path) {
    if (!this._signed.has(path)) {
      const p = this._hass
        .callWS({ type: "auth/sign_path", path, expires: SIGN_EXPIRY_SECONDS })
        .then((r) => r.path)
        .catch((err) => {
          this._signed.delete(path);
          throw err;
        });
      this._signed.set(path, p);
    }
    return this._signed.get(path);
  }

  _hydrateCovers(root) {
    root.querySelectorAll("img[data-cover]").forEach((img) => {
      const path = img.dataset.cover;
      const cached = this._signedCache?.get(path);
      if (cached) {
        if (img.getAttribute("src") !== cached) img.setAttribute("src", cached);
        return;
      }
      this._sign(path)
        .then((signed) => {
          this._signedCache = this._signedCache || new Map();
          this._signedCache.set(path, signed);
          img.setAttribute("src", signed);
        })
        .catch(() => img.remove());
    });
  }

  _coverHtml(recipeId, title) {
    return `<div class="mc-cover">
      <div class="mc-cover-fallback">${esc(title)}</div>
      ${recipeId ? `<img data-cover="/api/mealie_hub/recipes/${esc(recipeId)}/image" alt="" loading="lazy" onerror="this.remove()">` : ""}
    </div>`;
  }

  async _loadRecipes() {
    const path = this._tagFilter ? `mealie_hub/recipes?tags=${encodeURIComponent(this._tagFilter)}` : "mealie_hub/recipes";
    try {
      const data = await this._api("GET", path);
      this._recipes = data.items || [];
      this._recipesLoaded = true;
      this._error = null;
    } catch (err) {
      this._error = errMessage(err);
    }
    this._render();
  }

  async _loadTags() {
    try {
      const data = await this._api("GET", "mealie_hub/tags");
      this._tags = data.items || [];
    } catch (err) {
      this._error = errMessage(err);
    }
    this._render();
  }

  _setTagFilter(slug) {
    slug = slug || null;
    this._tagFilter = this._tagFilter === slug ? null : slug;
    this._recipesLoaded = false;
    this._loadRecipes();
  }

  async _loadShoppingList() {
    try {
      const data = await this._api("GET", "mealie_hub/shopping-list");
      this._shoppingItems = data.items || [];
      this._shoppingLoaded = true;
      this._shoppingError = null;
    } catch (err) {
      this._shoppingError = err?.body?.error === "no_shopping_list"
        ? "Lege in Mealie zuerst eine Einkaufsliste an."
        : errMessage(err);
      this._shoppingLoaded = true;
    }
    this._render();
  }

  async _toggleShoppingItem(itemId) {
    const item = this._shoppingItems.find((i) => i.id === itemId);
    if (!item) return;
    const before = item.checked;
    item.checked = !before;
    this._render();
    try {
      await this._api("PUT", `mealie_hub/shopping-list/items/${encodeURIComponent(itemId)}`, { checked: item.checked });
    } catch (err) {
      item.checked = before;
      this._error = errMessage(err);
      this._render();
    }
  }

  async _addToShoppingList(recipeId) {
    this._addToListBusy = true;
    this._render();
    try {
      await this._api("POST", `mealie_hub/recipes/${encodeURIComponent(recipeId)}/shopping-list`);
      this._shoppingLoaded = false; // refetched next time the tab opens
      this._showDetailHint = "Zur Einkaufsliste hinzugefügt.";
    } catch (err) {
      this._showDetailHint = `Fehler: ${errMessage(err)}`;
    }
    this._addToListBusy = false;
    this._render();
  }

  async _saveTags(slug, tags) {
    try {
      const result = await this._api("PATCH", `mealie_hub/recipes/${encodeURIComponent(slug)}/tags`, { tags });
      if (this._detail && this._detail.slug === slug) this._detail.tags = result.tags || tags.map((t) => ({ name: t }));
      this._loadTags();
    } catch (err) {
      this._error = errMessage(err);
    }
    this._render();
  }

  _addTag() {
    const name = this._tagDraft.trim();
    if (!name || !this._detail) return;
    const names = (this._detail.tags || []).map((t) => t.name);
    if (names.includes(name)) return;
    this._tagDraft = "";
    this._saveTags(this._detail.slug, [...names, name]);
  }

  _removeTag(name) {
    if (!this._detail) return;
    const names = (this._detail.tags || []).map((t) => t.name).filter((n) => n !== name);
    this._saveTags(this._detail.slug, names);
  }

  async _openDetail(slug) {
    this._detailSlug = slug;
    this._detail = null;
    this._tagDraft = "";
    this._showDetailHint = null;
    this._render();
    try {
      this._detail = await this._api("GET", `mealie_hub/recipes/${encodeURIComponent(slug)}`);
    } catch (err) {
      this._error = errMessage(err);
      this._detailDialog.close();
      this._render();
      return;
    }
    this._render();
  }

  // Imports run one at a time: submitting while one is already running queues
  // it instead, so several links can be pasted in quick succession and each
  // one's turn (and the current one's progress) stays visible.
  _submitImport() {
    const url = this._importUrl.trim();
    if (!url) return;
    this._importUrl = "";
    if (this._importRunning) {
      this._importQueue.push(url);
    } else {
      this._startImport(url);
    }
    this._render();
  }

  _cancelQueued(url) {
    const i = this._importQueue.indexOf(url);
    if (i >= 0) this._importQueue.splice(i, 1);
    this._render();
  }

  async _startImport(url) {
    this._importRunning = url;
    this._importStartedAt = Date.now();
    clearInterval(this._importTickTimer);
    this._importTickTimer = setInterval(() => this._render(), 1000);
    this._render();
    let entry;
    try {
      const result = await this._api("POST", "mealie_hub/import", { url });
      entry = { url, slug: result.slug };
      this._recipesLoaded = false; // the new recipe should show up next time the library is opened
      this._loadRecipes();
    } catch (err) {
      entry = { url, error: errMessage(err) };
    }
    this._importHistory.unshift(entry);
    this._importHistory.length = Math.min(this._importHistory.length, IMPORT_HISTORY_MAX);
    clearInterval(this._importTickTimer);
    this._importRunning = null;
    const next = this._importQueue.shift();
    if (next) {
      this._startImport(next);
    } else {
      this._render();
    }
  }

  // ── Delegated events ─────────────────────────────────────────────────

  _handleClick = (ev) => {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const handler = this[`_onAction_${el.dataset.action}`];
    if (typeof handler === "function") {
      ev.preventDefault();
      handler.call(this, el, ev);
    }
  };

  _handleInput = (ev) => {
    const el = ev.target.closest("[data-input]");
    if (!el) return;
    const handler = this[`_onInput_${el.dataset.input}`];
    if (typeof handler === "function") handler.call(this, el, ev);
  };

  _handleSubmit = (ev) => {
    const el = ev.target.closest("[data-form]");
    if (!el) return;
    ev.preventDefault();
    const handler = this[`_onForm_${el.dataset.form}`];
    if (typeof handler === "function") handler.call(this, el, ev);
  };

  _onAction_switchTab(el) {
    this._activeTab = el.dataset.tab;
    if (this._activeTab === "shopping" && !this._shoppingLoaded) this._loadShoppingList();
    this._render();
  }

  _onAction_dismissError() {
    this._error = null;
    this._render();
  }

  _onAction_openRecipe(el) {
    this._openDetail(el.dataset.slug);
  }

  _onAction_closeDialog() {
    this._detailDialog.close();
  }

  _onInput_search(el) {
    this._search = el.value;
    this._render();
  }

  _onInput_importUrl(el) {
    this._importUrl = el.value;
  }

  _onForm_import() {
    this._submitImport();
  }

  _onAction_cancelQueued(el) {
    this._cancelQueued(el.dataset.url);
  }

  _onAction_selectTag(el) {
    this._setTagFilter(el.dataset.slug);
  }

  _onAction_toggleShoppingItem(el) {
    this._toggleShoppingItem(el.dataset.id);
  }

  _onAction_addToShoppingList() {
    if (this._detail) this._addToShoppingList(this._detail.id);
  }

  _onAction_removeTag(el) {
    this._removeTag(el.dataset.name);
  }

  _onInput_tagDraft(el) {
    this._tagDraft = el.value;
  }

  _onAction_addTag() {
    this._addTag();
  }

  // ── Rendering ────────────────────────────────────────────────────────

  _render() {
    if (!this._skeletonReady) return;
    this._shellEl.innerHTML = `
      <div class="mc-header"><div class="mc-title">${esc(this._config.title)}</div></div>
      <div class="mc-nav">
        ${TABS.map(
          (t) => `<button class="mc-nav-btn ${t.key === this._activeTab ? "active" : ""}" data-action="switchTab" data-tab="${t.key}">
            <ha-icon icon="${t.icon}"></ha-icon><span>${esc(t.label)}</span></button>`
        ).join("")}
      </div>
      ${this._error ? `<div class="mc-error"><ha-icon icon="mdi:alert-circle"></ha-icon><span>${esc(this._error)}</span>
          <button data-action="dismissError">✕</button></div>` : ""}
      <div class="mc-panel">${
        this._activeTab === "import" ? this._renderImport() : this._activeTab === "shopping" ? this._renderShoppingList() : this._renderLibrary()
      }</div>
    `;
    this._hydrateCovers(this._shellEl);

    if (this._detailSlug) {
      const html = this._renderDetail();
      if (html !== this._detailDialog._html) {
        this._detailDialog._html = html;
        this._detailDialog.innerHTML = html;
      }
      if (!this._detailDialog.open) this._detailDialog.showModal();
      this._hydrateCovers(this._overlayRoot);
    } else if (this._detailDialog?.open) {
      this._detailDialog.close();
    }
  }

  _renderLibrary() {
    const chips = this._tags.length
      ? `<div class="mc-chips">
          <button class="mc-chip ${!this._tagFilter ? "active" : ""}" data-action="selectTag" data-slug="">Alle</button>
          ${this._tags
            .map((t) => `<button class="mc-chip ${this._tagFilter === t.slug ? "active" : ""}" data-action="selectTag" data-slug="${esc(t.slug)}">${esc(t.name)}</button>`)
            .join("")}
        </div>`
      : "";
    if (!this._recipesLoaded) return `${chips}<div class="mc-loading">Lädt …</div>`;
    const q = this._search.trim().toLowerCase();
    const shown = q ? this._recipes.filter((r) => (r.name || "").toLowerCase().includes(q)) : this._recipes;
    if (!this._recipes.length) return `${chips}<div class="mc-empty">Noch keine Rezepte in Mealie.</div>`;
    return `
      <div class="mc-searchbar"><input data-input="search" placeholder="Rezepte durchsuchen …" value="${esc(this._search)}"></div>
      ${chips}
      <div class="mc-grid">${shown.map((r) => this._renderTile(r)).join("")}</div>
      ${shown.length === 0 ? `<div class="mc-empty">Keine Treffer.</div>` : ""}
    `;
  }

  _renderTile(recipe) {
    return `<div class="mc-tile" data-action="openRecipe" data-slug="${esc(recipe.slug)}">
      ${this._coverHtml(recipe.id, recipe.name)}
      <div class="mc-tile-title">${esc(recipe.name)}</div>
    </div>`;
  }

  _renderDetail() {
    const close = `<button class="mc-btn secondary round mc-sheet-close" data-action="closeDialog" aria-label="Schließen"><ha-icon icon="mdi:close"></ha-icon></button>`;
    const item = this._detail;
    if (!item) return `<div class="mc-sheet">${close}<div class="mc-sheet-scroll"><div class="mc-loading">Lädt …</div></div></div>`;
    const ingredients = (item.recipeIngredient || []).map(ingredientText).filter(Boolean);
    const steps = (item.recipeInstructions || []).map((s) => (typeof s === "string" ? s : s.text || ""));
    const coverPath = `/api/mealie_hub/recipes/${item.id}/image`;
    const cachedCover = this._signedCache?.get(coverPath);
    return `<div class="mc-sheet mc-detail">
      ${close}
      <div class="mc-banner" style="${cachedCover ? `background-image:url('${esc(cachedCover)}')` : ""}"></div>
      <div class="mc-sheet-scroll">
        <div class="mc-detail-cover">
          <div class="mc-cover-fallback">${esc(item.name)}</div>
          ${item.id ? `<img data-cover="${esc(coverPath)}" alt="" onerror="this.remove()">` : ""}
        </div>
        <div class="mc-detail-title">${esc(item.name)}</div>
        <div class="mc-chips">
          ${(item.tags || [])
            .map((t) => `<button class="mc-chip removable" data-action="removeTag" data-name="${esc(t.name)}">${esc(t.name)}<ha-icon icon="mdi:close"></ha-icon></button>`)
            .join("")}
        </div>
        <div class="mc-tag-add">
          <input data-input="tagDraft" placeholder="Tag hinzufügen …" value="${esc(this._tagDraft)}">
          <button class="mc-btn secondary" data-action="addTag">+</button>
        </div>
        <button class="mc-btn block" style="margin-top:14px" data-action="addToShoppingList" ${this._addToListBusy ? "disabled" : ""}>
          <ha-icon icon="mdi:cart-plus"></ha-icon>${this._addToListBusy ? "Wird hinzugefügt …" : "Zur Einkaufsliste hinzufügen"}
        </button>
        ${this._showDetailHint ? `<div class="mc-hint">${esc(this._showDetailHint)}</div>` : ""}
        ${ingredients.length ? `<h4>Zutaten</h4><ul>${ingredients.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
        ${steps.length ? `<h4>Zubereitung</h4><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      </div>
    </div>`;
  }

  _renderShoppingList() {
    if (!this._shoppingLoaded) return `<div class="mc-loading">Lädt …</div>`;
    if (this._shoppingError) return `<div class="mc-empty">${esc(this._shoppingError)}</div>`;
    if (!this._shoppingItems.length) return `<div class="mc-empty">Die Einkaufsliste ist leer.</div>`;
    const sorted = [...this._shoppingItems].sort((a, b) => (a.checked ? 1 : 0) - (b.checked ? 1 : 0));
    return `<div class="mc-shopping-list">${sorted
      .map(
        (i) => `<label class="mc-shopping-item ${i.checked ? "checked" : ""}">
          <input type="checkbox" data-action="toggleShoppingItem" data-id="${esc(i.id)}" ${i.checked ? "checked" : ""}>
          <span>${esc(i.display || i.note || "")}</span>
        </label>`
      )
      .join("")}</div>`;
  }

  _renderImport() {
    const elapsed = this._importRunning ? Math.round((Date.now() - this._importStartedAt) / 1000) : 0;
    return `
      <form data-form="import" class="mc-import-row">
        <input data-input="importUrl" placeholder="Link zu einem Rezept oder Insta/TikTok-Video" value="${esc(this._importUrl)}">
        <button type="submit" class="mc-btn">Importieren</button>
      </form>
      ${
        this._importRunning
          ? `<div class="mc-job"><div class="mc-spinner"></div><span class="mc-job-url">${esc(this._importRunning)}</span>
              <span class="mc-job-time">${elapsed}s</span></div>`
          : `<div class="mc-hint">Instagram/TikTok/Facebook/Pinterest-Links und YouTube-Shorts gehen automatisch über Social-to-Mealie, alle anderen Links über Mealies eigenen Import. Videos können mehrere Minuten dauern.</div>`
      }
      ${
        this._importQueue.length
          ? `<div class="mc-queue">${this._importQueue
              .map(
                (u, i) => `<div class="mc-queue-item"><span>${i + 1}. ${esc(u)}</span>
                  <button data-action="cancelQueued" data-url="${esc(u)}" aria-label="Entfernen"><ha-icon icon="mdi:close"></ha-icon></button></div>`
              )
              .join("")}</div>`
          : ""
      }
      ${
        this._importHistory.length
          ? `<h4>Zuletzt</h4>${this._importHistory
              .map(
                (h) =>
                  `<div class="mc-history-item ${h.error ? "err" : "ok"}">
                    <ha-icon icon="${h.error ? "mdi:alert-circle-outline" : "mdi:check-circle-outline"}"></ha-icon>
                    <span>${esc(h.url)}</span>${h.error ? `<span>${esc(h.error)}</span>` : ""}
                  </div>`
              )
              .join("")}`
          : ""
      }
    `;
  }
}

class MealieHubCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...DEFAULT_CONFIG, ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    if (!this._config) return;
    this.innerHTML = `
      <ha-textfield label="Titel" data-field="title" value="${esc(this._config.title)}"></ha-textfield>
    `;
    this.querySelector("[data-field='title']")?.addEventListener("input", (ev) => {
      this._config = { ...this._config, title: ev.target.value };
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
    });
  }
}

customElements.define(CARD_TAG, MealieHubCard);
customElements.define(EDITOR_TAG, MealieHubCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: CARD_TAG,
  name: "Mealie Hub Card",
  description: "Rezepte aus Mealie durchstöbern und per Link importieren.",
});

console.info(`%c MEALIE-HUB-CARD %c v${CARD_VERSION} `, "color: white; background: #558b2f; font-weight: 700;", "color: #558b2f; background: white; font-weight: 700;");
