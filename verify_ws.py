import json, time, urllib.request, urllib.error

def cdp_request(method, params=None, session_id=None):
    url = f"http://localhost:9222/json/{method}"
    if method == "command":
        data = {"id": 1, "method": params["method"], "params": params.get("params", {})}
        if session_id:
            data["sessionId"] = session_id
        req = urllib.request.Request("http://localhost:9222/session/" + session_id, data=json.dumps(data).encode(), headers={"Content-Type":"application/json"}, method="POST")
    else:
        req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

# list tabs and pick the page
tabs = json.loads(urllib.request.urlopen("http://localhost:9222/json/list", timeout=30).read())
print("tabs:", [t.get("url") for t in tabs])
page = next((t for t in tabs if "localhost:1420" in t.get("url", "")), tabs[0])
ws_url = page["webSocketDebuggerUrl"]
print("using tab", page["id"], page["url"])

import websocket
ws = websocket.create_connection(ws_url)

def eval_expr(expr):
    ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expr, "awaitPromise": True, "returnByValue": True}}))
    return json.loads(ws.recv())

# focus root node / click
r = eval_expr("""
  const rootEl = document.querySelector('[style*=\"position: absolute\"]');
  if (!rootEl) return {error: 'no root node'};
  rootEl.click();
  return {ok: true, label: rootEl.innerText};
""")
print('root click:', r.get('result',{}).get('value'))

before = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes before Tab:', before.get('result',{}).get('value'))

add = eval_expr("""
  const canvas = document.querySelector('.canvas-container > div');
  if (!canvas) return {error: 'no canvas'};
  canvas.focus();
  const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return {dispatched: true};
""")
print('Tab dispatch:', add.get('result',{}).get('value'))

time.sleep(0.5)
after = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes after Tab:', after.get('result',{}).get('value'))

labels = eval_expr("Array.from(document.querySelectorAll('[style*=\"position: absolute\"]')).map(el => el.innerText)")
print('labels after Tab:', labels.get('result',{}).get('value'))

# collapse
r2 = eval_expr("""
  const rootEl = document.querySelector('[style*=\"position: absolute\"]');
  if (rootEl) rootEl.click();
  const canvas = document.querySelector('.canvas-container > div');
  const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return {dispatched: true};
""")
print('Space collapse dispatch:', r2.get('result',{}).get('value'))

time.sleep(0.5)
after_collapse = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes after collapse:', after_collapse.get('result',{}).get('value'))

# expand
r3 = eval_expr("""
  const canvas = document.querySelector('.canvas-container > div');
  const ev = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, cancelable: true });
  canvas.dispatchEvent(ev);
  return {dispatched: true};
""")
print('Space expand dispatch:', r3.get('result',{}).get('value'))

time.sleep(0.5)
after_expand = eval_expr("document.querySelectorAll('[style*=\"position: absolute\"]').length")
print('visible nodes after expand:', after_expand.get('result',{}).get('value'))

ws.close()
