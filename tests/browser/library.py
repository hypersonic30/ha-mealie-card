"""Library tab: tile rendering, expand/collapse detail, a failed detail load."""
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

    names = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-name')].map(e => e.textContent)")
    check("tile shows the recipe name", names == ["Suppe"], names)
    img = pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile img')?.getAttribute('src')")
    check("tile image uses the proxied image_url", img == "/img/r1", img)

    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    detail_text = pg.evaluate("() => card.shadowRoot.querySelector('.mc-detail')?.innerText || ''")
    check("detail shows the ingredient", "Zwiebel" in detail_text, detail_text)
    check("detail shows the step", "schneiden" in detail_text, detail_text)

    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(100)
    closed = pg.evaluate("() => card.shadowRoot.querySelector('.mc-detail')")
    check("clicking again collapses the detail", closed is None, closed)

    # A detail fetch that 404s surfaces as a dismissable error banner, not a stuck "Lädt …".
    pg.evaluate("() => { window.scenario.detail = {}; }")
    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    err = pg.evaluate("() => card.shadowRoot.querySelector('.mc-error')?.textContent || ''")
    check("a failed detail load shows the error banner", "not found" in err, err)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
