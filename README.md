# Web Coworker

Private AI coworker in your Chrome side panel. Ask about any page, or switch on **Act mode** and it clicks, types and navigates for you.

- **Your model, your choice.** Run fully local with Ollama or LM Studio, so pages never leave your machine, or bring your own Anthropic/OpenAI key.
- **No account, no backend, no tracking.** The extension talks only to the model you pick. Settings stay in your browser.
- **Read-only by default.** Ask mode can't click or type. Act mode is an explicit switch, and Stop works at any time.

## Install

1. `chrome://extensions` → enable Developer mode
2. **Load unpacked** → pick this folder
3. Click the toolbar icon (or Alt+Shift+C) → open **Settings**, add API key + model, Save

Providers: Anthropic (default model `claude-sonnet-5-5`), or any OpenAI-compatible endpoint via Base URL
(OpenAI, OpenRouter, Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`).
Ollama needs `OLLAMA_ORIGINS=chrome-extension://*` to accept extension requests.

## How it works

```
sidepanel.js ──port "agent"──▶ background.js ──▶ agent.js runAgent loop ──▶ providers.js (LLM)
                                    │ chrome.tabs.sendMessage
                                    ▼
                               content.js  (get_elements → refs, click, type, scroll, read_page)
```

- Ask mode: only `read_page`, `get_elements`, `scroll`, `done`. Act adds `click`, `type`, `navigate`.
- Page output is wrapped in `<untrusted_page_content>`; system prompt says never obey it.
- 30-step cap, Stop button aborts the in-flight request.

## Test

```bash
node test.mjs
```

## Not built (yet)

CDP trusted clicks, planner, site adapters, screenshots/vision, persistence across worker restarts, Firefox. Add when a real task fails without them.
