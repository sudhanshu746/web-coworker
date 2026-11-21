// Two providers cover most setups: Anthropic, and OpenAI-compatible
// (OpenAI, OpenRouter, Ollama, LM Studio via baseUrl).

async function post(url, headers, body, signal) {
  // Hung model servers otherwise leave the panel on "Thinking…" forever.
  const timeout = AbortSignal.timeout(120000);
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    .catch(e => { throw timeout.aborted ? new Error('Model request timed out after 120s.') : e; });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

export function toAnthropicMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const content = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.tool_calls || []) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
      out.push({ role: 'assistant', content });
    } else if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content };
      const last = out.at(-1);
      // Consecutive tool results must share one user turn.
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    }
  }
  return out;
}

export function makeChat(settings, system) {
  const { provider, apiKey, model, baseUrl } = settings;

  if (provider === 'anthropic') {
    return async (messages, tools, signal) => {
      const data = await post('https://api.anthropic.com/v1/messages', {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }, {
        model: model || 'claude-sonnet-5-5',
        max_tokens: 4096,
        system,
        messages: toAnthropicMessages(messages),
        tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })),
      }, signal);
      return {
        text: data.content.filter(b => b.type === 'text').map(b => b.text).join('\n'),
        toolCalls: data.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input })),
      };
    };
  }

  return async (messages, tools, signal) => {
    const data = await post(`${(baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`,
      apiKey ? { authorization: `Bearer ${apiKey}` } : {}, {
        model,
        messages: [{ role: 'system', content: system }, ...messages.map(m => m.role === 'assistant'
          ? { role: 'assistant', content: m.content, tool_calls: m.tool_calls?.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) }
          : m.role === 'tool' ? { role: 'tool', tool_call_id: m.tool_call_id, content: m.content } : m)],
        tools: tools.map(t => ({ type: 'function', function: t })),
      }, signal);
    const msg = data.choices[0].message;
    return {
      text: msg.content || '',
      toolCalls: (msg.tool_calls || []).map(c => ({ id: c.id, name: c.function.name, args: JSON.parse(c.function.arguments || '{}') })),
    };
  };
}
