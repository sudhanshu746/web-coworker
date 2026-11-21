// Page reader + actor. Refs stay stable per element via a WeakRef registry.
if (!window.__wcLoaded) {
  window.__wcLoaded = true;

  const refs = new Map();      // ref -> WeakRef<Element>
  const ids = new WeakMap();   // Element -> ref
  let next = 1;

  const refOf = el => {
    if (!ids.has(el)) { const r = `ref_${next++}`; ids.set(el, r); refs.set(r, new WeakRef(el)); }
    return ids.get(el);
  };
  const byRef = r => {
    const el = refs.get(r)?.deref();
    if (!el || !el.isConnected) throw new Error(`${r} not found; call get_elements again.`);
    return el;
  };
  const visible = el => {
    const s = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0;
  };
  const label = el => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || el.alt || el.name || '')
    .trim().replace(/\s+/g, ' ').slice(0, 80);
  const role = el => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox' })[el.tagName]
    || (el.tagName === 'INPUT' ? (['checkbox', 'radio', 'submit', 'button'].includes(el.type) ? el.type : 'textbox') : el.isContentEditable ? 'textbox' : el.tagName.toLowerCase());

  const SELECTOR = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [contenteditable=true], [onclick]';

  const tools = {
    read_page: () => `Title: ${document.title}\nURL: ${location.href}\n\n${document.body.innerText.slice(0, 15000)}`,

    get_elements: () => {
      for (const [r, w] of refs) if (!w.deref()?.isConnected) refs.delete(r);
      const lines = [];
      for (const el of document.querySelectorAll(SELECTOR)) {
        if (!visible(el)) continue;
        let line = `${role(el)} "${label(el)}" [${refOf(el)}]`;
        if (el.tagName === 'A') line += ` href="${el.getAttribute('href').slice(0, 80)}"`;
        if (el.disabled) line += ' (disabled)';
        if (el.checked) line += ' (checked)';
        lines.push(line);
        if (lines.length >= 300) { lines.push('…truncated'); break; }
      }
      return lines.join('\n') || 'No interactive elements.';
    },

    scroll: ({ direction }) => {
      window.scrollBy({ top: (direction === 'up' ? -1 : 1) * innerHeight * 0.8 });
      return `Scrolled ${direction}. Now at ${Math.round(scrollY)}/${document.documentElement.scrollHeight}px.`;
    },

    click: ({ ref }) => {
      const el = byRef(ref);
      el.scrollIntoView({ block: 'center' });
      el.click();
      return `Clicked ${role(el)} "${label(el)}".`;
    },

    type: ({ ref, text, submit }) => {
      const el = byRef(ref);
      el.scrollIntoView({ block: 'center' });
      el.focus();
      if (el.isContentEditable) {
        document.execCommand('selectAll');
        document.execCommand('insertText', false, text);
      } else {
        // Native setter so React/Vue controlled inputs see the change.
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (submit) {
        for (const type of ['keydown', 'keypress', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.form?.requestSubmit();
      }
      return `Typed into ${role(el)} "${label(el)}"${submit ? ' and submitted' : ''}.`;
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const fn = tools[msg.tool];
    if (!fn) return;
    try { sendResponse({ result: fn(msg.args || {}) }); }
    catch (e) { sendResponse({ error: e.message }); }
  });
}
