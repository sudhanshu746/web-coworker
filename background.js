import { runAgent, systemPrompt } from './agent.js';
import { makeChat } from './providers.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const log = (...a) => console.log('[web-coworker]', ...a);

// Conversations live in storage.session: the MV3 worker is killed after ~30s idle, memory is not safe.
const convKey = tabId => `conv:${tabId}`;
const loadConv = async tabId => (await chrome.storage.session.get(convKey(tabId)))[convKey(tabId)] || [];
const saveConv = (tabId, messages) => chrome.storage.session.set({ [convKey(tabId)]: messages });

async function sendToTab(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Tab opened before install has no content script yet.
    log('injecting content.js into tab', tabId);
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

function waitForLoad(tabId) {
  return new Promise(resolve => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); clearTimeout(timer); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, 15000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function execTool(tabId, name, args) {
  if (name === 'navigate') {
    if (!/^https?:\/\//i.test(args.url)) throw new Error('Only http(s) URLs allowed.');
    await chrome.tabs.update(tabId, { url: args.url });
    await waitForLoad(tabId);
    return `Navigated to ${args.url}`;
  }
  const res = await sendToTab(tabId, { tool: name, args });
  if (res?.error) throw new Error(res.error);
  // Let the page react to clicks/typing before the next read.
  if (name === 'click' || name === 'type') await new Promise(r => setTimeout(r, 800));
  return res?.result ?? '';
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'reset') chrome.storage.session.remove(convKey(msg.tabId));
});

// Panel opens one port per run; the connect itself wakes a sleeping worker.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'agent') return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  const send = m => { try { port.postMessage(m); } catch {} };

  port.onMessage.addListener(async msg => {
    if (msg.type === 'stop') return controller.abort();
    if (msg.type !== 'chat') return;

    const { tabId } = msg;
    const { settings = {} } = await chrome.storage.local.get('settings');
    log('run', { tabId, mode: msg.mode, provider: settings.provider, model: settings.model || '(default)' });
    if (!settings.apiKey && settings.provider !== 'openai') return send({ type: 'error', text: 'Add your API key in Settings and click Save.' });
    if (!settings.model && settings.provider === 'openai') return send({ type: 'error', text: 'Set a model in Settings.' });

    const messages = await loadConv(tabId);
    messages.push({ role: 'user', content: msg.text });

    // Extension API calls reset the worker idle timer; keeps it alive during slow model calls.
    const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
    try {
      const answer = await runAgent({
        chat: makeChat(settings, systemPrompt(msg.mode)),
        execTool: (name, args) => execTool(tabId, name, args),
        messages,
        mode: msg.mode,
        signal: controller.signal,
        onUpdate: u => { log(u.type, u.name || '', u.args || u.text || ''); send(u); },
      });
      send({ type: 'answer', text: answer });
    } catch (e) {
      log('error', e);
      send(controller.signal.aborted ? { type: 'answer', text: 'Stopped.' } : { type: 'error', text: e.message });
    } finally {
      clearInterval(keepAlive);
      await saveConv(tabId, messages);
    }
  });
});
