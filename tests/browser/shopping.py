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

    # Deleting a single item: the delete button is a sibling of the checkbox's
    # <label>, not nested inside it, so clicking it must not also toggle the item.
    items_before_delete = pg.evaluate("() => card.shadowRoot.querySelectorAll('.mc-shopping-item').length")
    pg.evaluate("() => card.shadowRoot.querySelector('[data-action=deleteShoppingItem][data-id=i2]').click()")
    pg.wait_for_timeout(200)
    delete_call = pg.evaluate("() => window.calls.filter(c => c.method === 'DELETE' && c.path.includes('shopping-list/items')).pop()?.path")
    check("deleting an item calls the item's delete endpoint", delete_call == "mealie_hub/shopping-list/items/i2", delete_call)
    items_after_delete = pg.evaluate("() => card.shadowRoot.querySelectorAll('.mc-shopping-item').length")
    check("the deleted item disappears from the list", items_after_delete == items_before_delete - 1, (items_before_delete, items_after_delete))
    stray_put = pg.evaluate("() => window.calls.filter(c => c.method === 'PUT').length")
    check("deleting i2 never also toggled it via the label's click-forwarding", stray_put == 1, stray_put)  # only i1's earlier toggle

    # "Erledigte entfernen" clears every still-checked item (i1, toggled above) in one go.
    clear_visible = pg.evaluate("() => !!card.shadowRoot.querySelector('[data-action=clearCheckedItems]')")
    check("the clear-checked button shows while a checked item remains", clear_visible, clear_visible)
    pg.evaluate("() => card.shadowRoot.querySelector('[data-action=clearCheckedItems]').click()")
    pg.wait_for_timeout(200)
    clear_call = pg.evaluate("() => window.calls.some(c => c.method === 'POST' && c.path === 'mealie_hub/shopping-list/clear-checked')")
    check("clearing checked items posts to the clear-checked endpoint", clear_call, clear_call)
    empty_after_clear = pg.evaluate("() => card.shadowRoot.querySelector('.mc-empty')?.textContent || ''")
    check("the list is empty after clearing the last (checked) item", "leer" in empty_after_clear, empty_after_clear)

    # Adding a recipe's ingredients from its detail view — "soup" has recipeServings: 4.
    pg.evaluate("() => { card._activeTab = 'library'; card._render(); }")
    pg.evaluate("() => card.shadowRoot.querySelector('.mc-tile').click()")
    pg.wait_for_timeout(200)
    servings_shown = pg.evaluate("() => card._overlayRoot.querySelector('.mc-servings-value')?.textContent || ''")
    check("the servings picker defaults to the recipe's own servings count", servings_shown == "4", servings_shown)
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=addToShoppingList]').click()")
    pg.wait_for_timeout(200)
    add_call = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/recipes/r1/shopping-list').pop()")
    check("the add-to-list button posts to the recipe's shopping-list endpoint", add_call is not None, add_call)
    check("adding at the default (unchanged) servings count sends scale 1", add_call["body"]["scale"] == 1, add_call)
    hint = pg.evaluate("() => card._overlayRoot.querySelector('.mc-hint')?.textContent || ''")
    check("a success hint is shown in the detail dialog", "hinzugefügt" in hint, hint)

    # Raising the servings picker to 6 (from a base of 4) scales the request by 1.5x.
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=incServings]').click()")
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=incServings]').click()")
    pg.wait_for_timeout(100)
    servings_after_inc = pg.evaluate("() => card._overlayRoot.querySelector('.mc-servings-value')?.textContent || ''")
    check("the stepper's +  button raises the shown servings count", servings_after_inc == "6", servings_after_inc)
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=addToShoppingList]').click()")
    pg.wait_for_timeout(200)
    scaled_call = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/recipes/r1/shopping-list').pop()")
    check("asking for 6 instead of the base 4 servings sends scale 1.5", scaled_call["body"]["scale"] == 1.5, scaled_call)

    # The stepper never goes below 1 serving.
    for _ in range(10):
        pg.evaluate("() => card._overlayRoot.querySelector('[data-action=decServings]').click()")
    pg.wait_for_timeout(100)
    servings_floor = pg.evaluate("() => card._overlayRoot.querySelector('.mc-servings-value')?.textContent || ''")
    check("the stepper's - button never goes below 1 serving", servings_floor == "1", servings_floor)

    # A recipe with no known servings count has nothing sensible to scale against,
    # so it skips the picker entirely and just adds the recipe as stored (scale 1).
    pg.evaluate(
        "() => { card._detail = { id: 'r2', slug: 'noserv', name: 'Ohne Portionen', recipeIngredient: [], recipeInstructions: [] }; "
        "card._detailSlug = 'noserv'; card._shoppingServings = null; card._render(); }"
    )
    pg.wait_for_timeout(100)
    picker_shown = pg.evaluate("() => !!card._overlayRoot.querySelector('.mc-servings-picker')")
    check("a recipe without a servings count shows no picker", not picker_shown, picker_shown)
    pg.evaluate("() => card._overlayRoot.querySelector('[data-action=addToShoppingList]').click()")
    pg.wait_for_timeout(100)
    noserv_call = pg.evaluate("() => window.calls.filter(c => c.method === 'POST' && c.path === 'mealie_hub/recipes/r2/shopping-list').pop()")
    check("...and still adds it (unscaled) when the picker is hidden", noserv_call["body"]["scale"] == 1, noserv_call)

    # A household with no shopping list yet shows a clear hint instead of an empty/broken tab.
    pg.evaluate("() => { window.scenario.shopping = { error: 'no_shopping_list' }; card._shoppingLoaded = false; card._activeTab = 'shopping'; card._onAction_switchTab({dataset: {tab: 'shopping'}}); }")
    pg.wait_for_timeout(200)
    empty_hint = pg.evaluate("() => card.shadowRoot.querySelector('.mc-empty')?.textContent || ''")
    check("a missing shopping list shows a clear hint instead of breaking", "Einkaufsliste" in empty_hint, empty_hint)

    check("no page errors", not errs, errs)
    b.close()
print("ALL PASSED" if not fails else f"FAILED: {fails}"); sys.exit(1 if fails else 0)
