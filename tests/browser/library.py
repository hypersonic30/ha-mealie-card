"""Library tab: tile rendering, signed cover image, detail dialog (open/close), a failed detail load."""
from _server import *
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, extra=""):
    print(("PASS " if c else "FAIL ") + n, "" if c else f"\n      {extra}")
    if not c: fails.append(n)

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox"])
    pg = b.new_page(viewport={"width": 420, "height": 900}); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8323/page.html")
    pg.evaluate(
        "() => { const c = document.createElement('mealie-hub-card'); c.setConfig({type:'custom:mealie-hub-card'}); "
        "document.body.appendChild(c); c.hass = window.hassStub; window.card = c; }"
    )
    pg.wait_for_timeout(300)

    names = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-tile-title')].map(e => e.textContent)")
    check("tile shows the recipe name", names == ["Suppe"], names)

    # The image is loaded via a signed path (plain <img> tags can't send a bearer
    # header), not the raw proxied URL directly. Checked via the sign call itself,
    # not the <img>'s final src: against this stub server the signed URL still
    # 404s for real, so the <img onerror="this.remove()"> fires and the element
    # is gone by the time we could inspect it — that removal-on-404 is itself
    # correct production behavior, just not reproducible without a real backend.
    sign_calls = pg.evaluate("() => window.calls.filter(c => c.ws && c.ws.type === 'auth/sign_path').map(c => c.ws.path)")
    check("the card asked Home Assistant to sign that exact path", "/api/mealie_hub/recipes/r1/image" in sign_calls, sign_calls)

    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    dialog_open = pg.evaluate("() => card._overlayRoot.getElementById('mc-detail').open")
    check("the detail dialog opens (showModal)", dialog_open, dialog_open)
    detail_text = pg.evaluate("() => card._overlayRoot.getElementById('mc-detail').innerText")
    check("detail shows the ingredient's display text", "1 Stück Zwiebel" in detail_text, detail_text)
    check("a structured ingredient object never renders as [object Object]", "[object Object]" not in detail_text, detail_text)
    check("detail shows the step", "schneiden" in detail_text, detail_text)
    sheet_w = pg.evaluate("() => card._overlayRoot.querySelector('.mc-sheet').getBoundingClientRect().width")
    check("the sheet fills (close to) the viewport width, not a tiny popup", sheet_w >= 400, sheet_w)

    orig_href = pg.evaluate("() => card._overlayRoot.querySelector('a[href]')?.getAttribute('href')")
    check("the original source link is shown and points at orgURL", orig_href == "https://example.com/original-soup", orig_href)

    # The close button must live inside the scrolling content, not pinned to the
    # sheet's own edge: in the HA Companion app's WebView the sheet can render
    # taller than the actually visible area, leaving nothing positioned against
    # its outer edge reachable (no way to scroll back up to it). A button inside
    # .mc-sheet-scroll always scrolls into view with everything else.
    close_in_scroll = pg.evaluate(
        "() => { const scroll = card._overlayRoot.querySelector('.mc-sheet-scroll'); "
        "const btn = card._overlayRoot.querySelector('[data-action=closeDialog]'); "
        "return scroll.contains(btn); }"
    )
    check("the close button is inside the scrollable area, not fixed to the sheet's outer edge", close_in_scroll, close_in_scroll)
    close_buttons = pg.evaluate("() => card._overlayRoot.querySelectorAll('[data-action=closeDialog]').length")
    check("there is a second, redundant close button further down as a safety net", close_buttons >= 2, close_buttons)

    # Deleting a recipe asks for confirmation; cancelling leaves it untouched.
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=askDelete]').click()")
    pg.wait_for_timeout(100)
    confirm_shown = pg.evaluate("() => !!card._overlayRoot.querySelector('[data-action=confirmDelete]')")
    check("asking to delete shows a confirmation, not an immediate delete", confirm_shown, confirm_shown)
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=cancelDelete]').click()")
    pg.wait_for_timeout(100)
    still_has_ask = pg.evaluate("() => !!card._overlayRoot.querySelector('[data-action=askDelete]')")
    check("cancelling goes back to the plain delete button", still_has_ask, still_has_ask)
    delete_calls_before_cancel = pg.evaluate("() => window.calls.filter(c => c.method === 'DELETE').length")
    check("cancelling never actually called the delete endpoint", delete_calls_before_cancel == 0, delete_calls_before_cancel)

    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=askDelete]').click()")
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=confirmDelete]').click()")
    pg.wait_for_timeout(200)
    dialog_after_delete = pg.evaluate("() => card._overlayRoot.getElementById('mc-detail').open")
    check("confirming the delete closes the dialog", not dialog_after_delete, dialog_after_delete)
    delete_call = pg.evaluate("() => window.calls.filter(c => c.method === 'DELETE').pop()?.path")
    check("the delete call targets the right recipe slug", delete_call == "mealie_hub/recipes/soup", delete_call)

    # A failed delete surfaces an error and leaves the confirmation state recoverable.
    pg.evaluate("() => { window.scenario.deleteRecipe = { ok: false, error: 'permission_denied' }; }")
    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=askDelete]').click()")
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=confirmDelete]').click()")
    pg.wait_for_timeout(200)
    err_after_failed_delete = pg.evaluate("() => card.shadowRoot.querySelector('.mc-error')?.textContent || ''")
    check("a failed delete shows an error instead of silently closing", "permission_denied" in err_after_failed_delete, err_after_failed_delete)
    dialog_after_failed_delete = pg.evaluate("() => card._overlayRoot.getElementById('mc-detail').open")
    check("the dialog stays open after a failed delete", dialog_after_failed_delete, dialog_after_failed_delete)

    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=closeDialog]').click()")
    pg.wait_for_timeout(200)
    dialog_closed = not pg.evaluate("() => card._overlayRoot.getElementById('mc-detail').open")
    check("the close button closes the dialog", dialog_closed, dialog_closed)

    # A detail fetch that 404s surfaces as a dismissable error banner, not a stuck dialog.
    pg.evaluate("() => { window.scenario.detail = {}; }")
    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    err = pg.evaluate("() => card.shadowRoot.querySelector('.mc-error')?.textContent || ''")
    check("a failed detail load shows the error banner", "not found" in err, err)
    still_open = pg.evaluate("() => card._overlayRoot.getElementById('mc-detail').open")
    check("the dialog does not stay open on a failed load", not still_open, still_open)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
