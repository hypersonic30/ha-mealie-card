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
 * License: MIT
 */
"use strict";

const CARD_VERSION = "0.1.0";
const CARD_TAG = "mealie-hub-card";
const EDITOR_TAG = "mealie-hub-card-editor";

const DEFAULT_CONFIG = {
  title: "Rezepte",
  default_tab: "library",
  poll_seconds: 0, // 0 = no auto-refresh; the library is cheap to refresh manually
};

const TABS = [
  { key: "library", label: "Bibliothek", icon: "mdi:book-open-variant" },
  { key: "import", label: "Importieren", icon: "mdi:link-plus" },
];

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function errMessage(err) {
  const body = err && err.body;
  if (body && typeof body.error === "string") return body.error;
  if (err && typeof err.message === "string") return err.message;
  return "Unbekannter Fehler";
}

const STYLE = `
  :host { display: block; }
  .mc-card { font-family: var(--paper-font-body1_-_font-family, inherit); }
  .mc-nav { display: flex; gap: 4px; padding: 8px 12px 0; }
  .mc-nav-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 8px 4px; border: none; background: none; color: var(--secondary-text-color);
    border-radius: 12px; font: inherit; cursor: pointer; }
  .mc-nav-btn.active { color: var(--primary-color); background: rgba(var(--rgb-primary-color, 3,169,244), 0.12); }
  .mc-panel { padding: 12px; }
  .mc-error { display: flex; align-items: center; gap: 8px; margin: 0 12px; padding: 8px 12px;
    background: var(--error-color, #db4437); color: #fff; border-radius: 8px; }
  .mc-error button { background: none; border: none; color: #fff; margin-left: auto; cursor: pointer; }
  .mc-search { width: 100%; box-sizing: border-box; padding: 8px 12px; border-radius: 8px;
    border: 1px solid var(--divider-color); font: inherit; margin-bottom: 12px; }
  .mc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .mc-tile { cursor: pointer; border-radius: 12px; overflow: hidden; background: var(--card-background-color);
    border: 1px solid var(--divider-color); }
  .mc-tile img { width: 100%; height: 100px; object-fit: cover; display: block; background: var(--divider-color); }
  .mc-tile .mc-name { padding: 6px 8px; font-size: 0.9em; }
  .mc-detail { margin-top: 10px; padding: 12px; border-radius: 12px; background: var(--card-background-color);
    border: 1px solid var(--divider-color); }
  .mc-detail img { width: 100%; max-height: 220px; object-fit: cover; border-radius: 8px; margin-bottom: 8px; }
  .mc-detail h3 { margin: 0 0 8px; }
  .mc-detail h4 { margin: 12px 0 4px; }
  .mc-detail ul, .mc-detail ol { margin: 0; padding-left: 20px; }
  .mc-import-row { display: flex; gap: 8px; }
  .mc-import-row input { flex: 1; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--divider-color); font: inherit; }
  .mc-import-row button { padding: 10px 16px; border-radius: 8px; border: none; background: var(--primary-color);
    color: var(--text-primary-color, #fff); font: inherit; cursor: pointer; }
  .mc-import-row button:disabled { opacity: 0.6; cursor: default; }
  .mc-hint { color: var(--secondary-text-color); font-size: 0.9em; margin-top: 8px; }
  .mc-empty { color: var(--secondary-text-color); padding: 24px 0; text-align: center; }
`;

class MealieHubCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = { ...DEFAULT_CONFIG };
    this._hass = null;
    this._connected = false;
    this._activeTab = DEFAULT_CONFIG.default_tab;
    this._error = null;

    this._recipes = [];
    this._recipesLoaded = false;
    this._search = "";
    this._openSlug = null;
    this._detail = null; // slug -> recipe (only the open one is kept)

    this._importUrl = "";
    this._importBusy = false;
    this._importResult = null; // {slug} | {error}
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._connected) this._loadRecipes();
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

  connectedCallback() {
    this._connected = true;
    this.shadowRoot.addEventListener("click", this._handleClick);
    this.shadowRoot.addEventListener("input", this._handleInput);
    this.shadowRoot.addEventListener("submit", this._handleSubmit);
    this._render();
    if (this._hass) this._loadRecipes();
  }

  disconnectedCallback() {
    this._connected = false;
    this.shadowRoot.removeEventListener("click", this._handleClick);
    this.shadowRoot.removeEventListener("input", this._handleInput);
    this.shadowRoot.removeEventListener("submit", this._handleSubmit);
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

  async _loadRecipes() {
    try {
      const data = await this._api("GET", "mealie_hub/recipes");
      this._recipes = data.items || [];
      this._recipesLoaded = true;
      this._error = null;
    } catch (err) {
      this._error = errMessage(err);
    }
    this._render();
  }

  async _openDetail(slug) {
    if (this._openSlug === slug) {
      this._openSlug = null;
      this._render();
      return;
    }
    this._openSlug = slug;
    this._detail = null;
    this._render();
    try {
      this._detail = await this._api("GET", `mealie_hub/recipes/${encodeURIComponent(slug)}`);
    } catch (err) {
      this._error = errMessage(err);
    }
    this._render();
  }

  async _submitImport() {
    const url = this._importUrl.trim();
    if (!url) return;
    this._importBusy = true;
    this._importResult = null;
    this._render();
    try {
      const result = await this._api("POST", "mealie_hub/import", { url });
      this._importResult = { slug: result.slug };
      this._importUrl = "";
      this._recipesLoaded = false; // the new recipe should show up next time the library is opened
      this._loadRecipes();
    } catch (err) {
      this._importResult = { error: errMessage(err) };
    }
    this._importBusy = false;
    this._render();
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
    this._render();
  }

  _onAction_dismissError() {
    this._error = null;
    this._render();
  }

  _onAction_openRecipe(el) {
    this._openDetail(el.dataset.slug);
  }

  _onAction_refresh() {
    this._recipesLoaded = false;
    this._loadRecipes();
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

  // ── Rendering ────────────────────────────────────────────────────────

  _render() {
    if (!this.shadowRoot.firstChild) {
      const style = document.createElement("style");
      style.textContent = STYLE;
      this.shadowRoot.appendChild(style);
      const root = document.createElement("div");
      root.className = "mc-card";
      this.shadowRoot.appendChild(root);
    }
    const root = this.shadowRoot.querySelector(".mc-card");
    root.innerHTML = `
      <div class="mc-nav">
        ${TABS.map(
          (t) => `<button class="mc-nav-btn ${t.key === this._activeTab ? "active" : ""}" data-action="switchTab" data-tab="${t.key}">
            <ha-icon icon="${t.icon}"></ha-icon><span>${esc(t.label)}</span></button>`
        ).join("")}
      </div>
      ${this._error ? `<div class="mc-error"><ha-icon icon="mdi:alert-circle"></ha-icon><span>${esc(this._error)}</span>
          <button data-action="dismissError">✕</button></div>` : ""}
      <div class="mc-panel">${this._activeTab === "import" ? this._renderImport() : this._renderLibrary()}</div>
    `;
  }

  _renderLibrary() {
    if (!this._recipesLoaded) return `<div class="mc-empty">Lädt …</div>`;
    const q = this._search.trim().toLowerCase();
    const shown = q ? this._recipes.filter((r) => (r.name || "").toLowerCase().includes(q)) : this._recipes;
    if (!this._recipes.length) return `<div class="mc-empty">Noch keine Rezepte in Mealie.</div>`;
    return `
      <input class="mc-search" data-input="search" placeholder="Rezepte durchsuchen …" value="${esc(this._search)}">
      <div class="mc-grid">${shown.map((r) => this._renderTile(r)).join("")}</div>
      ${shown.length === 0 ? `<div class="mc-empty">Keine Treffer.</div>` : ""}
    `;
  }

  _renderTile(recipe) {
    const open = this._openSlug === recipe.slug;
    return `
      <div>
        <div class="mc-tile" data-action="openRecipe" data-slug="${esc(recipe.slug)}">
          ${recipe.image_url ? `<img src="${esc(recipe.image_url)}" loading="lazy">` : ""}
          <div class="mc-name">${esc(recipe.name)}</div>
        </div>
        ${open ? this._renderDetail() : ""}
      </div>
    `;
  }

  _renderDetail() {
    if (!this._detail) return `<div class="mc-detail">Lädt …</div>`;
    const ingredients = this._detail.recipeIngredient || [];
    const steps = (this._detail.recipeInstructions || []).map((s) => (typeof s === "string" ? s : s.text || ""));
    return `
      <div class="mc-detail">
        ${this._detail.image_url ? `<img src="${esc(this._detail.image_url)}">` : ""}
        <h3>${esc(this._detail.name)}</h3>
        ${ingredients.length ? `<h4>Zutaten</h4><ul>${ingredients.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}
        ${steps.length ? `<h4>Zubereitung</h4><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>` : ""}
      </div>
    `;
  }

  _renderImport() {
    const result = this._importResult;
    return `
      <form data-form="import" class="mc-import-row">
        <input data-input="importUrl" placeholder="Link zu einem Rezept oder Insta/TikTok-Video" value="${esc(this._importUrl)}"
          ${this._importBusy ? "disabled" : ""}>
        <button type="submit" ${this._importBusy ? "disabled" : ""}>${this._importBusy ? "Lädt …" : "Importieren"}</button>
      </form>
      ${
        result && result.slug
          ? `<div class="mc-hint">Importiert: ${esc(result.slug)}</div>`
          : result && result.error
          ? `<div class="mc-hint">Fehler: ${esc(result.error)}</div>`
          : `<div class="mc-hint">Instagram/TikTok/Facebook/Pinterest-Links und YouTube-Shorts gehen automatisch über Social-to-Mealie, alle anderen Links über Mealies eigenen Import.</div>`
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
