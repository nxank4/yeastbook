const SYSTEM_PROMPT = `You are a TypeScript code assistant for Yeastbook, a Bun-powered notebook.
Generate concise, working TypeScript code for Bun runtime.
Top-level await is supported. $ shell operator is available.
Return only the code, no explanation, no markdown fences.`;

export function buildPrompt(prompt: string, context: string[]) {
  const contextStr = context.length > 0 ? `\nContext from surrounding cells:\n${context.join("\n---\n")}` : "";
  return { system: SYSTEM_PROMPT, user: `${prompt}${contextStr}` };
}

export function buildFixPrompt(code: string, error: string) {
  return {
    system: SYSTEM_PROMPT,
    user: `Fix this TypeScript code for Bun runtime:\n\n\`\`\`typescript\n${code}\n\`\`\`\n\nError: ${error}\n\nReturn only the fixed code.`,
  };
}

export async function* streamAI(
  provider: "anthropic" | "openai",
  apiKey: string,
  system: string,
  user: string,
): AsyncGenerator<string> {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system,
        messages: [{ role: "user", content: user }],
        stream: true,
      }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) yield parsed.delta.text;
          } catch {}
        }
      }
    }
  } else {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        stream: true,
      }),
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch {}
        }
      }
    }
  }
}
