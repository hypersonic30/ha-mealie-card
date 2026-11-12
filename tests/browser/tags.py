"""Tag filter chips in the library, and adding/removing a tag from the detail dialog."""
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

    chips = pg.evaluate("() => [...card.shadowRoot.querySelectorAll('.mc-chip')].map(e => e.textContent)")
    check("the library shows a chip for every tag, plus 'Alle'", chips == ["Alle", "vegan", "schnell"], chips)

    pg.click("button.mc-chip:has-text('vegan')")
    pg.wait_for_timeout(200)
    path = pg.evaluate("() => window.calls.filter(c => c.method === 'GET' && c.path.startsWith('mealie_hub/recipes')).pop()?.path")
    check("selecting a tag refetches the library filtered by its slug", path == "mealie_hub/recipes?tags=vegan", path)
    active = pg.evaluate("() => card.shadowRoot.querySelector('.mc-chip.active')?.textContent")
    check("the selected chip is marked active", active == "vegan", active)

    pg.click("button.mc-chip:has-text('vegan')")  # clicking the active chip again clears the filter
    pg.wait_for_timeout(200)
    active2 = pg.evaluate("() => card.shadowRoot.querySelector('.mc-chip.active')?.textContent")
    check("clicking the active chip again clears the filter back to 'Alle'", active2 == "Alle", active2)

    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    tag_chips = pg.evaluate("() => [...card._overlayRoot.querySelectorAll('.mc-chip.removable')].map(e => e.textContent)")
    check("the detail dialog shows the recipe's existing tags", any("vegan" in t for t in tag_chips), tag_chips)

    # The tag input suggests existing tags (not already on this recipe) via a native
    # <datalist>, but the field itself stays a plain text input — free text still works.
    suggestions = pg.evaluate("() => [...card._overlayRoot.querySelectorAll('#mc-tag-options option')].map(o => o.value)")
    check("the recipe's own tag ('vegan') is not suggested again", "vegan" not in suggestions, suggestions)
    check("an existing tag not yet on this recipe is suggested", "schnell" in suggestions, suggestions)
    list_attr = pg.evaluate("() => card._overlayRoot.querySelector('dialog .mc-tag-add input').getAttribute('list')")
    check("the tag input is wired to the suggestion list", list_attr == "mc-tag-options", list_attr)

    pg.fill("dialog .mc-tag-add input", "schnell")
    pg.click("dialog .mc-tag-add button")
    pg.wait_for_timeout(200)
    patch_body = pg.evaluate("() => window.calls.filter(c => c.method === 'PATCH').pop()?.body")
    check("adding a tag PATCHes the full new tag list", patch_body == {"tags": ["vegan", "schnell"]}, patch_body)

    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=removeTag]').click()")
    pg.wait_for_timeout(200)
    patch_body2 = pg.evaluate("() => window.calls.filter(c => c.method === 'PATCH').pop()?.body")
    check("removing a tag PATCHes the list without it", "vegan" not in patch_body2["tags"], patch_body2)

    # The datalist only ever suggests existing tags — typing something new and
    # unsuggested must still create it, not be rejected as an invalid choice.
    pg.fill("dialog .mc-tag-add input", "glutenfrei")
    pg.click("dialog .mc-tag-add button")
    pg.wait_for_timeout(200)
    patch_body3 = pg.evaluate("() => window.calls.filter(c => c.method === 'PATCH').pop()?.body")
    check("a brand-new tag not in the suggestion list can still be added", "glutenfrei" in patch_body3["tags"], patch_body3)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
