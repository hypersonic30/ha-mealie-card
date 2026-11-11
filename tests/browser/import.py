"""Import tab: running job indicator, queueing a second import, history, cancelling a queued link, an upstream error."""
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
    pg.evaluate("() => { window.scenario.import.delayMs = 400; }")
    pg.evaluate(
        "() => { const c = document.createElement('mealie-hub-card'); c.setConfig({type:'custom:mealie-hub-card'}); "
        "document.body.appendChild(c); c.hass = window.hassStub; window.card = c; }"
    )
    pg.wait_for_timeout(300)
    pg.evaluate("() => { card._activeTab = 'import'; card._render(); }")

    pg.fill(".mc-import-row input", "https://www.instagram.com/reel/first/")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    job = pg.evaluate("() => card.shadowRoot.querySelector('.mc-job-url')?.textContent || ''")
    check("the running job shows while the import is in flight", "first" in job, job)

    # Submitting a second link while the first is still running queues it instead of racing it.
    pg.fill(".mc-import-row input", "https://www.tiktok.com/@x/video/second")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    queue = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-queue-item span')].map(e => e.textContent)")
    check("the second link is queued, not started yet", any("second" in q for q in queue), queue)
    sent_bodies = pg.evaluate("() => window.calls.filter(c => c.path === 'mealie_hub/import').map(c => c.body.url)")
    check("only the first URL has actually been sent so far", sent_bodies == ["https://www.instagram.com/reel/first/"], sent_bodies)

    pg.wait_for_timeout(600)  # first job's 400ms delay elapses, queued second job starts and finishes
    history = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-history-item span')].map(e => e.textContent)")
    check("both imports land in the history, most recent first", history and "second" in history[0], history)
    queue_after = pg.evaluate("() => card.shadowRoot.querySelectorAll('.mc-queue-item').length")
    check("the queue is empty once both jobs ran", queue_after == 0, queue_after)

    # Cancelling a queued (not yet started) link removes it without ever calling the backend for it.
    pg.evaluate("() => { window.scenario.import.delayMs = 1000; }")
    pg.fill(".mc-import-row input", "https://example.com/a")
    pg.click(".mc-import-row button")
    pg.fill(".mc-import-row input", "https://example.com/b")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    pg.click(".mc-queue-item button")
    pg.wait_for_timeout(100)
    queue_b = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-queue-item span')].map(e => e.textContent)")
    check("cancelling the queued link removes it from the queue", not any("example.com/b" in q for q in queue_b), queue_b)
    pg.wait_for_timeout(1100)

    pg.evaluate("() => { window.scenario.import = { ok: false, status: 400, error: 'social_not_configured' }; }")
    pg.fill(".mc-import-row input", "https://www.tiktok.com/@x/video/1")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(200)
    err_entry = pg.evaluate("() => card.shadowRoot.querySelector('.mc-history-item.err')?.textContent || ''")
    check("an upstream error lands in the history as an error entry", "social_not_configured" in err_entry, err_entry)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
