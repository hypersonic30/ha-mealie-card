"""Import tab: a successful import, and an upstream error."""
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
    pg.evaluate("() => { card._activeTab = 'import'; card._render(); }")

    pg.fill(".mc-import-row input", "https://www.instagram.com/reel/abc123/")
    calls_before = pg.evaluate("() => window.calls.length")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(200)
    hint = pg.evaluate("() => card.shadowRoot.querySelector('.mc-hint')?.textContent || ''")
    check("a successful import shows the new slug", "soup" in hint, hint)
    sent = pg.evaluate("(n) => window.calls[n].body", calls_before)
    check("the raw URL is sent to the import endpoint", sent["url"] == "https://www.instagram.com/reel/abc123/", sent)

    pg.evaluate("() => { window.scenario.import = { ok: false, status: 400, error: 'social_not_configured' }; }")
    pg.fill(".mc-import-row input", "https://www.tiktok.com/@x/video/1")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(200)
    hint2 = pg.evaluate("() => card.shadowRoot.querySelector('.mc-hint')?.textContent || ''")
    check("an upstream error is shown", "social_not_configured" in hint2, hint2)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
