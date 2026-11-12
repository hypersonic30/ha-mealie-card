"""Import tab: the queue/running/history now live server-side (mirrored here by
window.scenario.importState + window.finishCurrentImportJob, simulating the
backend's import_queue.py), so this exercises submit -> poll -> observe instead of
submit -> await a direct result. That's also what makes a reload survivable: the
card resyncs via one poll call, same as `card._pollImportStatus()` below."""
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

    pg.fill(".mc-import-row input", "https://www.instagram.com/reel/first/")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    job = pg.evaluate("() => card.shadowRoot.querySelector('.mc-job-url')?.textContent || ''")
    check("the running job shows after submitting (enqueue + poll)", "first" in job, job)

    # Submitting a second link while the first is still running queues it instead of racing it.
    pg.fill(".mc-import-row input", "https://www.tiktok.com/@x/video/second")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    queue = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-queue-item span')].map(e => e.textContent)")
    check("the second link is queued, not started yet", any("second" in q for q in queue), queue)
    sent_urls = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').map(c => c.body.url)")
    check("both URLs were enqueued (server decides who runs, not the browser)", len(sent_urls) == 2, sent_urls)
    still_running_first = pg.evaluate("() => card.shadowRoot.querySelector('.mc-job-url')?.textContent || ''")
    check("the first job is still the one shown as running", "first" in still_running_first, still_running_first)

    # The simulated backend worker finishes job 1 and immediately picks up job 2 (queue -> running).
    pg.evaluate("() => window.finishCurrentImportJob({ slug: 'first-slug' })")
    pg.evaluate("() => card._pollImportStatus()")
    pg.wait_for_timeout(100)
    history_after_first = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-history-item span')].map(e => e.textContent)")
    check("the finished job lands in the history", any("first" in h for h in history_after_first), history_after_first)
    now_running = pg.evaluate("() => card.shadowRoot.querySelector('.mc-job-url')?.textContent || ''")
    check("the queued job starts automatically once the first one finishes", "second" in now_running, now_running)

    pg.evaluate("() => window.finishCurrentImportJob({ slug: 'second-slug' })")
    pg.evaluate("() => card._pollImportStatus()")
    pg.wait_for_timeout(100)
    history = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-history-item span')].map(e => e.textContent)")
    check("both imports land in the history, most recent first", history and "second" in history[0], history)
    queue_after = pg.evaluate("() => card.shadowRoot.querySelectorAll('.mc-queue-item').length")
    check("the queue is empty once both jobs ran", queue_after == 0, queue_after)
    still_running = pg.evaluate("() => card.shadowRoot.querySelector('.mc-job')")
    check("nothing is shown as running once the queue drains", still_running is None, still_running)

    # Cancelling a queued (not yet started) link removes it on the server, not just locally.
    pg.fill(".mc-import-row input", "https://example.com/a")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    pg.fill(".mc-import-row input", "https://example.com/b")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    pg.click(".mc-queue-item button")
    pg.wait_for_timeout(200)
    cancel_call = pg.evaluate("() => window.calls.filter(c => c.path === 'mealie_hub/import/cancel').pop()")
    check("cancelling posts to the cancel endpoint with that URL", cancel_call["body"]["url"] == "https://example.com/b", cancel_call)
    queue_b = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-queue-item span')].map(e => e.textContent)")
    check("the cancelled link is gone from the queue", not any("example.com/b" in q for q in queue_b), queue_b)
    pg.evaluate("() => window.finishCurrentImportJob({ slug: 'a-slug' })")
    pg.evaluate("() => card._pollImportStatus()")

    # An upstream error (not a duplicate) lands in the history as an error entry.
    pg.fill(".mc-import-row input", "https://www.tiktok.com/@x/video/boom")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    pg.evaluate("() => window.finishCurrentImportJob({ error: 'social_not_configured' })")
    pg.evaluate("() => card._pollImportStatus()")
    pg.wait_for_timeout(100)
    err_entry = pg.evaluate("() => card.shadowRoot.querySelector('.mc-history-item.err')?.textContent || ''")
    check("an upstream error lands in the history as an error entry", "social_not_configured" in err_entry, err_entry)

    # A plain (non-duplicate) failure also gets a retry button, so a timeout or
    # upstream error doesn't force retyping the whole link.
    retry_btn = pg.evaluate(
        "() => [...card.shadowRoot.querySelectorAll('.mc-history-item.err')]"
        ".find(el => el.textContent.includes('boom'))?.querySelector('[data-action=retryImportUrl]')"
    )
    check("a plain import error shows a retry button", retry_btn is not None, retry_btn)
    calls_before_plain_retry = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    pg.evaluate(
        "() => [...card.shadowRoot.querySelectorAll('.mc-history-item.err')]"
        ".find(el => el.textContent.includes('boom')).querySelector('[data-action=retryImportUrl]').click()"
    )
    pg.wait_for_timeout(100)
    plain_retry_call = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').pop()")
    check(
        "clicking it resends that same URL with force:true",
        plain_retry_call["body"]["url"] == "https://www.tiktok.com/@x/video/boom" and plain_retry_call["body"]["force"] is True,
        plain_retry_call,
    )
    calls_after_plain_retry = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    check("the plain-error retry actually made a new request", calls_after_plain_retry == calls_before_plain_retry + 1, (calls_before_plain_retry, calls_after_plain_retry))
    pg.evaluate("() => window.finishCurrentImportJob({ slug: 'boom-retry-slug' })")
    pg.evaluate("() => card._pollImportStatus()")

    # Resubmitting a link already running/queued/just-succeeded (this session) asks for
    # confirmation instead of enqueueing a duplicate — checked purely against the
    # locally-synced state, no extra network round trip.
    pg.fill(".mc-import-row input", "https://example.com/dup")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    pg.evaluate("() => card._pollImportStatus()")  # sync local state so the next submit can recognize it
    calls_before = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    pg.fill(".mc-import-row input", "https://example.com/dup")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    warn = pg.evaluate("() => card.shadowRoot.querySelector('.mc-warn-box')?.textContent || ''")
    check("resubmitting a running link shows a local confirmation, no network call", "example.com/dup" in warn, warn)
    calls_after = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    check("the duplicate was not actually sent again yet", calls_after == calls_before, (calls_before, calls_after))
    pg.click("button[data-action=forceImport]")
    pg.wait_for_timeout(100)
    calls_forced = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    check("'Trotzdem importieren' does send it (queued behind the running one)", calls_forced == calls_before + 1, calls_forced)
    pg.evaluate("() => window.finishCurrentImportJob({ slug: 'dup-slug' })")
    pg.evaluate("() => window.finishCurrentImportJob({ slug: 'dup-slug-2' })")
    pg.evaluate("() => card._pollImportStatus()")

    # The backend's own duplicate check (against every existing recipe, not just this
    # session) answers 409 — the card shows "schon vorhanden" with a retry button
    # that resends with force:true.
    pg.evaluate("() => { window.scenario.importDuplicates['https://example.com/already-there'] = 'old-soup'; }")
    pg.fill(".mc-import-row input", "https://example.com/already-there")
    pg.click(".mc-import-row button")
    pg.wait_for_timeout(100)
    dup_entry = pg.evaluate("() => card.shadowRoot.querySelector('.mc-history-item.warn')?.textContent || ''")
    check("a server-side duplicate shows the existing recipe's slug", "old-soup" in dup_entry, dup_entry)
    calls_before_retry = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    pg.click("button[data-action=forceImportUrl]")
    pg.wait_for_timeout(100)
    retry_call = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').pop()")
    check("the retry resends the same URL with force:true", retry_call["body"]["url"] == "https://example.com/already-there" and retry_call["body"]["force"] is True, retry_call)
    calls_after_retry = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/import').length")
    check("the retry actually made a new request", calls_after_retry == calls_before_retry + 1, (calls_before_retry, calls_after_retry))

    # The actual bug this whole architecture change was for: a page "reload" (a brand
    # new card instance, since the old one is gone on a real reload) must pick up a
    # still-running job and the still-waiting queue from the server, not start empty.
    pg.evaluate(
        "() => { window.scenario.importState = { queue: [{ url: 'https://example.com/queued-across-reload', force: false }], "
        "running: { url: 'https://example.com/running-across-reload', started_at: Date.now() / 1000 - 5 }, history: [] }; }"
    )
    pg.evaluate(
        "() => { card.remove(); const c = document.createElement('mealie-hub-card'); c.setConfig({type:'custom:mealie-hub-card'}); "
        "document.body.appendChild(c); c.hass = window.hassStub; window.card = c; c._activeTab = 'import'; c._render(); }"
    )
    pg.wait_for_timeout(200)
    reloaded_running = pg.evaluate("() => card.shadowRoot.querySelector('.mc-job-url')?.textContent || ''")
    check("a fresh card instance (simulating a reload) recovers the running job", "running-across-reload" in reloaded_running, reloaded_running)
    reloaded_queue = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-queue-item span')].map(e => e.textContent)")
    check("...and the queued job too", any("queued-across-reload" in q for q in reloaded_queue), reloaded_queue)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
