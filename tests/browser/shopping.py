"""Shopping list tab: rendering, checking an item off, adding a recipe's ingredients from its detail dialog, and the empty-list hint."""
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
    pg.evaluate("() => { card._activeTab = 'shopping'; card._onAction_switchTab({dataset: {tab: 'shopping'}}); }")
    pg.wait_for_timeout(200)

    item_text = pg.evaluate("() => card.shadowRoot.querySelector('.mc-shopping-item span')?.textContent")
    check("the shopping list shows the item's display text", item_text == "1 Banane", item_text)

    pg.evaluate("() => card.shadowRoot.querySelector('.mc-shopping-item input').click()")
    pg.wait_for_timeout(200)
    put_body = pg.evaluate("() => window.calls.filter(c => c.method === 'PUT').pop()?.body")
    check("checking an item PUTs checked:true for it", put_body == { "checked": True }, put_body)
    checked_class = pg.evaluate("() => card.shadowRoot.querySelector('.mc-shopping-item').className")
    check("the checked item gets the struck-through style", "checked" in checked_class, checked_class)

    # Adding a recipe's ingredients from its detail view.
    pg.evaluate("() => { card._activeTab = 'library'; card._render(); }")
    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=addToShoppingList]').click()")
    pg.wait_for_timeout(200)
    add_call = pg.evaluate("() => window.calls.some(c => c.method === 'POST' && c.path === 'mealie_hub/recipes/r1/shopping-list')")
    check("the add-to-list button posts to the recipe's shopping-list endpoint", add_call, add_call)
    hint = pg.evaluate("() => card._overlayRoot.querySelector('.mc-hint')?.textContent || ''")
    check("a success hint is shown in the detail dialog", "hinzugefügt" in hint, hint)

    # A household with no shopping list yet shows a clear hint instead of an empty/broken tab.
    pg.evaluate("() => { window.scenario.shopping = { error: 'no_shopping_list' }; card._shoppingLoaded = false; card._activeTab = 'shopping'; card._onAction_switchTab({dataset: {tab: 'shopping'}}); }")
    pg.wait_for_timeout(200)
    empty_hint = pg.evaluate("() => card.shadowRoot.querySelector('.mc-empty')?.textContent || ''")
    check("a missing shopping list shows a clear hint instead of breaking", "Einkaufsliste" in empty_hint, empty_hint)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
