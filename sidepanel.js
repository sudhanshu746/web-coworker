const $ = id => document.getElementById(id);
const log = $('log');
const form = $('settings-form');
let port = null;

function add(cls, text) {
  const div = document.createElement('div');
  div.className = `msg ${cls}`;
  div.textContent = text;
  log.append(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

let status = null;
function busy(on) {
  $('send').hidden = on;
  $('stop').hidden = !on;
  $('input').disabled = on;
  status?.remove();
  status = on ? add('step', 'Thinking…') : null;
  if (!on) { port?.disconnect(); port = null; }
}

function onUpdate(u) {
  if (u.type === 'answer') add('answer', u.text);
  else if (u.type === 'error') add('error', u.text);
  else if (u.type === 'tool') add('step', `→ ${u.name}(${JSON.stringify(u.args)})`);
  else if (u.type === 'thought') add('step', u.text);
  if (u.type === 'answer' || u.type === 'error') return busy(false);
  log.append(status); // keep "Thinking…" last
}

// The panel's own window is the browser window it is docked to.
const currentTabId = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;

$('composer').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (!text) return;
  add('user', text);
  $('input').value = '';
  busy(true);
  // Fresh port per run: a port kept open from page load dies when the worker sleeps.
  port = chrome.runtime.connect({ name: 'agent' });
  port.onMessage.addListener(onUpdate);
  port.onDisconnect.addListener(() => { if (port) { add('error', 'Lost connection to background. Try again.'); busy(false); } });
  port.postMessage({ type: 'chat', text, mode: $('act').checked ? 'act' : 'ask', tabId: await currentTabId() });
});
$('input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('composer').requestSubmit(); }
});
$('stop').onclick = () => port?.postMessage({ type: 'stop' });
$('reset').onclick = async () => { chrome.runtime.sendMessage({ type: 'reset', tabId: await currentTabId() }); log.replaceChildren(); };
$('act').onchange = () => document.body.classList.toggle('act', $('act').checked);

chrome.storage.local.get('settings').then(({ settings = {} }) => {
  for (const [k, v] of Object.entries(settings)) if (form.elements[k]) form.elements[k].value = v;
  if (!settings.apiKey && settings.provider !== 'openai') $('settings').open = true;
});
form.addEventListener('submit', e => {
  e.preventDefault();
  chrome.storage.local.set({ settings: Object.fromEntries(new FormData(form)) });
  $('settings').open = false;
});
