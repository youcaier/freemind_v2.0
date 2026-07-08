import pychrome, json, sys, time

# verify via Chrome DevTools Protocol on the Vite dev page
tab = pychrome.Tab(url='http://localhost:9222')
tab.start()

def eval_expr(expr):
    return tab.Runtime.evaluate(expression=expr, awaitPromise=True, returnByValue=True)

# focus canvas and simulate a click on root node to select it
root = eval_expr("""
  const rootEl = document.querySelector('[style*="position: absolute"]');
  if (!rootEl) return {error: 'no root node'};
  rootEl.click();
  return {ok: true, label: rootEl.innerText};
""")
print('root click:', root['result']['value'])

# count visible nodes before adding child
before = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes before Tab:', before['result']['value'])

# simulate Tab key to add child
add_result = eval_expr("""
  const canvas = document.querySelector('.canvas-container > div');
  if (!canvas) return {error: 'no canvas'};
  canvas.focus();
  const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return {dispatched: true};
""")
print('Tab dispatch:', add_result['result']['value'])

time.sleep(0.5)
after_tab = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes after Tab:', after_tab['result']['value'])

# read visible node labels
labels = eval_expr("""
  Array.from(document.querySelectorAll('[style*=\"position: absolute\"]')).map(el => el.innerText)
""")
print('labels after Tab:', labels['result']['value'])

# collapse/expand test: select root, press Space, count nodes, press Space again, count nodes
collapse = eval_expr("""
  const rootEl = document.querySelector('[style*=\"position: absolute\"]');
  if (!rootEl) return {error: 'no root'};
  rootEl.click();
  const canvas = document.querySelector('.canvas-container > div');
  const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return {dispatched: true};
""")
print('Space dispatch (collapse):', collapse['result']['value'])

time.sleep(0.5)
after_collapse = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes after collapse:', after_collapse['result']['value'])

expand = eval_expr("""
  const canvas = document.querySelector('.canvas-container > div');
  const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return {dispatched: true};
""")
print('Space dispatch (expand):', expand['result']['value'])

time.sleep(0.5)
after_expand = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes after expand:', after_expand['result']['value'])

tab.stop()
