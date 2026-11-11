// BLUR GOD VIEW — Gemini 代轉後端（Supabase Edge Function）
// Gemini Key 只存在 Supabase 的 Secrets（名稱：GEMINI_API_KEY），網站上看不到。
// 只接受來自 BLUR 網站的呼叫，別人拿網址也用不了。

const ALLOWED_ORIGINS = [
  "https://lyilln.github.io",
  "http://localhost:3000",
  "http://localhost:5173",
];

// 全部是免費額度可用的模型；一個額度用完就換下一個
const MODELS = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"];

const MAX_CHARS = 40000; // 防止有人塞超大內容

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}

function reply(origin: string, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.includes(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: allowed ? 204 : 403, headers: allowed ? cors(origin) : {} });
  }
  if (!allowed) return new Response("Forbidden", { status: 403 });
  if (req.method !== "POST") return reply(origin, 405, { code: "OTHER", message: "Method not allowed" });

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return reply(origin, 500, { code: "NO_KEY", message: "後端還沒設定 GEMINI_API_KEY" });

  let system = "", prompt = "", schema: unknown = null;
  try {
    const body = await req.json();
    system = String(body.system || "");
    prompt = String(body.prompt || "");
    schema = body.schema || null;
  } catch {
    return reply(origin, 400, { code: "OTHER", message: "請求格式錯誤" });
  }
  if (!prompt || system.length + prompt.length > MAX_CHARS) {
    return reply(origin, 400, { code: "OTHER", message: "內容是空的或太長" });
  }

  let last = { status: 500, code: "OTHER", message: "生成失敗" };

  for (const model of MODELS) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 1,
            ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}),
          },
        }),
      });
    } catch {
      last = { status: 502, code: "OVERLOAD", message: "連不到 Gemini" };
      continue;
    }

    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
      console.warn(`${model} ${res.status} ${detail}`);
      if (res.status === 403 || /API_KEY_INVALID|API key not valid/i.test(detail)) {
        return reply(origin, 500, { code: "BAD_KEY", message: "後端的 Gemini Key 無效" });
      }
      if (res.status === 429) { last = { status: 429, code: "RATE", message: "免費額度暫時用完了" }; continue; }
      if (res.status === 404 || res.status >= 500) { last = { status: 503, code: "OVERLOAD", message: "Gemini 忙線中" }; continue; }
      return reply(origin, 500, { code: "OTHER", message: `生成失敗（${res.status}）${detail.slice(0, 120)}` });
    }

    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === "string")
      .map((p: { text: string }) => p.text)
      .join("");
    if (text) return reply(origin, 200, { text, model });
    last = { status: 500, code: "OTHER", message: "回傳是空的" };
  }

  return reply(origin, last.status, { code: last.code, message: last.message });
});
