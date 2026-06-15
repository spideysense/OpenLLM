# Skill: Chrome Extension (Manifest V3)

Authoritative scaffold. Follow this architecture exactly. Do NOT invent APIs.

## Choosing the right architecture (READ FIRST)
- **Overlay UI on the current web page** (a drawer, sidebar, highlighter) + **global keyboard shortcut** → **content script + background service worker**. NOT a popup.
- **A small panel under the toolbar icon** → a `default_popup` is fine.
- A **popup CANNOT** draw onto the page and CANNOT receive a `commands` shortcut. If the user wants something that slides over the page on a hotkey, you MUST use a content script.

## Hard rules
- Manifest V3 **forbids inline `<script>`**. All JS lives in external `.js` files. No `chrome.commands.register` — that API does not exist; shortcuts are declared in `manifest.json` only.
- Site access (`<all_urls>`, `*://*/*`) goes under **`host_permissions`**, never `permissions`.
- The keyboard command is caught in the **background service worker**, which messages the content script to toggle.

## Working scaffold — a notes drawer that slides in on a hotkey

### manifest.json
```json
{
  "manifest_version": 3,
  "name": "Simple Notes",
  "version": "1.0",
  "description": "A quick notes drawer on any page.",
  "icons": { "128": "icon.png" },
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["content.js"], "css": ["content.css"], "run_at": "document_idle" }
  ],
  "commands": {
    "toggle-drawer": {
      "suggested_key": { "default": "Alt+N", "mac": "Alt+N" },
      "description": "Toggle the notes drawer"
    }
  },
  "host_permissions": ["<all_urls>"],
  "permissions": ["storage"]
}
```

### background.js (service worker — catches the shortcut)
```js
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-drawer') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_DRAWER' });
});
```

### content.js (injected into the page — builds + toggles the drawer)
```js
let drawer;
function buildDrawer() {
  drawer = document.createElement('div');
  drawer.id = 'sn-drawer';
  drawer.innerHTML = `
    <div id="sn-head">Notes</div>
    <textarea id="sn-input" placeholder="Type a note…"></textarea>
    <ul id="sn-list"></ul>`;
  document.body.appendChild(drawer);

  const input = drawer.querySelector('#sn-input');
  const list = drawer.querySelector('#sn-list');

  chrome.storage.local.get({ notes: [] }, ({ notes }) => render(notes, list));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      chrome.storage.local.get({ notes: [] }, ({ notes }) => {
        const next = [text, ...notes];
        chrome.storage.local.set({ notes: next }, () => render(next, list));
        input.value = '';
      });
    }
  });
}
function render(notes, list) {
  list.innerHTML = notes.map((n) => `<li>${n.replace(/</g, '&lt;')}</li>`).join('');
}
function toggle() {
  if (!drawer) buildDrawer();
  drawer.classList.toggle('open');
  if (drawer.classList.contains('open')) drawer.querySelector('#sn-input').focus();
}
chrome.runtime.onMessage.addListener((msg) => { if (msg.type === 'TOGGLE_DRAWER') toggle(); });
```

### content.css (drawer styling — starts off-screen, slides in with .open)
```css
#sn-drawer {
  position: fixed; top: 0; right: 0; width: 320px; height: 100vh;
  background: #fff; box-shadow: -2px 0 16px rgba(0,0,0,.15);
  transform: translateX(100%); transition: transform .25s ease;
  z-index: 2147483647; font-family: system-ui, sans-serif; padding: 16px; box-sizing: border-box;
}
#sn-drawer.open { transform: translateX(0); }
#sn-head { font-weight: 700; margin-bottom: 12px; }
#sn-input { width: 100%; height: 90px; padding: 8px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 8px; }
#sn-list { list-style: none; padding: 0; margin: 12px 0 0; }
#sn-list li { padding: 8px; border-bottom: 1px solid #eee; font-size: 14px; }
```

## Load + test
1. Folder with: manifest.json, background.js, content.js, content.css, icon.png (128×128).
2. chrome://extensions → enable Developer mode → Load unpacked → select the folder.
3. Open any normal webpage (not chrome:// pages — content scripts can't run there), press Alt+N.
4. If the shortcut is taken, reassign it at chrome://extensions/shortcuts.

## Common failures (and the fix)
- "nothing happens on the popup" → you used a popup for a page overlay. Switch to content script + background worker (above).
- CSP "inline script" errors → you left a `<script>` block inline. Move it to a `.js` file.
- "Permission '*://*/*' is unknown" → host patterns belong in `host_permissions`, not `permissions`.
- Drawer never appears → it's at `translateX(100%)` and `.open` is never added; confirm the message round-trip from background → content.
