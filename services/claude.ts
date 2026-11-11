import { SimulationBlock, SimulationEvent, SceneType, RelationshipLink } from "../types";
import { PERSONA_DATA, WORLD_VIEW } from "../constants";

// ===== 模型 =====
export const MODELS = [
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "推薦・品質速度平衡" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "文筆最好・較慢較貴" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "最快最省" },
] as const;

const KEY_STORE = "BLUR_CLAUDE_KEY";
const MODEL_STORE = "BLUR_CLAUDE_MODEL";

const safeGet = (k: string) => {
  try { return localStorage.getItem(k) || ""; } catch { return ""; }
};
const safeSet = (k: string, v: string) => {
  try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* ignore */ }
};

export const getApiKey = () => safeGet(KEY_STORE).trim();
export const setApiKey = (v: string) => safeSet(KEY_STORE, v.trim());
export const getModel = () => safeGet(MODEL_STORE) || MODELS[0].id;
export const setModel = (v: string) => safeSet(MODEL_STORE, v);

// ===== 錯誤 =====
export type SimErrorCode = "NO_KEY" | "BAD_KEY" | "NO_CREDIT" | "RATE" | "OVERLOAD" | "NETWORK" | "OTHER";

export class SimError extends Error {
  code: SimErrorCode;
  constructor(code: SimErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const ERROR_TEXT: Record<SimErrorCode, string> = {
  NO_KEY: "還沒放 Claude API Key，先到設定貼上",
  BAD_KEY: "這把 Key 無效，請到設定重新貼上",
  NO_CREDIT: "API 帳戶餘額不足，請到 Claude Console 儲值",
  RATE: "請求太頻繁了，等一下再試",
  OVERLOAD: "Claude 現在忙線中，稍後再試",
  NETWORK: "網路連線失敗，檢查一下網路",
  OTHER: "生成失敗",
};

// ===== 輸出格式（用 tool use 強制 Claude 回傳固定 JSON）=====
const EMIT_TOOL = {
  name: "emit_block",
  description: "輸出這一輪的模擬劇情區塊。",
  input_schema: {
    type: "object",
    properties: {
      locationLabel: { type: "string", description: "地點描述，例如「SBS 待機室」" },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ts: { type: "string", description: "時間，例如 23:41" },
            eventType: {
              type: "string",
              enum: ["message", "action", "stage_moment", "variety_beat", "scene_change", "system_note", "forum_post"],
            },
            participants: { type: "array", items: { type: "string" } },
            content: {
              type: "object",
              properties: {
                speaker: { type: "string" },
                text: { type: "string" },
                action: { type: "string" },
                outfit: { type: "string" },
                lighting: { type: "string" },
                camera: { type: "string" },
                choreography: { type: "string" },
                stage_phase: { type: "string", enum: ["待機室", "上台前", "舞台表演", "下台後"] },
                variety_persona: { type: "string" },
                detail: { type: "string" },
                mood: { type: "string", enum: ["happy", "tense", "emotional", "funny", "professional"] },
                title: { type: "string" },
                board: { type: "string" },
                replies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      author: { type: "string" },
                      text: { type: "string" },
                      type: { type: "string", enum: ["fan", "hater", "neutral", "shipper", "mom_fan"] },
                    },
                    required: ["author", "text", "type"],
                  },
                },
              },
            },
          },
          required: ["ts", "eventType", "participants", "content"],
        },
      },
    },
    required: ["locationLabel", "events"],
  },
};

// ===== 提示詞 =====
function sceneInstruction(scene: SceneType, subScene: string, dmPair: string[]): string {
  switch (scene) {
    case "stage":
      return `場景：音樂節目【${subScene || "M Countdown"}】打歌。
依時間順序產生 4 個事件，content.stage_phase 分別為：待機室、上台前、舞台表演、下台後。
「舞台表演」那個事件要填 outfit（造型）、lighting（燈光）、camera（運鏡，例如 Crane、推近）、choreography（編舞），並在 text 寫出 2 個 Killing Part。
主持人只用節目式口吻，不寫主持人私生活。`;
    case "variety":
      return `場景：綜藝節目【${subScene || "Weekly Idol"}】。
找出每位成員的綜藝人設（黑洞、吐槽擔當、省電模式…）填在 variety_persona。
要有 3 個 Killing Part。用 detail 寫後製字幕，例如「[字幕：這是什麼靈魂畫作？]」。eventType 用 variety_beat。`;
    case "forum":
      return `場景：粉絲論壇，看板【${subScene || "回歸討論"}】。
產生 1 個 eventType 為 forum_post 的事件：title 標題、content.speaker 填匿名 ID、text 內文、board 看板名。
replies 放 3–12 則回覆，type 混合理性粉、CP 粉、媽媽粉、黑粉、路人。內容要呼應最近的舞台或劇情。`;
    case "company":
      return `場景：SM 式經紀公司（走廊、經紀人座位或會議室）。工作人員只用職稱（A&R、經紀人、室長）。呈現職場階級與壓力。`;
    case "group_chat":
      return `場景：成員的團體聊天室（手機訊息）。
嚴格規定：只有訊息文字，不描述動作或內心。每則訊息一個 message 事件，產生 6–12 則，口語、短句、有貼圖感的語氣。`;
    case "dm":
      return `場景：${dmPair.length === 2 ? `${dmPair[0]} 和 ${dmPair[1]}` : "兩位成員"}之間的私訊。
嚴格規定：只有這兩人，只有訊息文字，不描述動作或內心。產生 6–12 則 message 事件。`;
    case "practice_room":
      return `場景：練習室。可以有動作描寫（放在 content.action），對話放 text。`;
    case "dorm":
      return `場景：宿舍日常。可以有動作描寫（放在 content.action），對話放 text。`;
    case "studio":
      return `場景：錄音室。有製作人與錄音師（只用職稱）。可以有動作描寫（放在 content.action）。`;
    default:
      return "";
  }
}

function historyText(history: SimulationEvent[] | undefined): string {
  const recent = (history || []).slice(-16);
  if (!recent.length) return "（這是這個場景的第一輪，請自然開場。）";
  return recent
    .map(ev => {
      const c = ev.content || {};
      if (ev.eventType === "forum_post") return `[論壇] ${c.title || ""}：${(c.text || "").slice(0, 80)}`;
      const who = c.speaker ? `${c.speaker}：` : "";
      const act = c.action ? `（${c.action}）` : "";
      return `[${ev.ts || ""}] ${who}${c.text || ""}${act}`;
    })
    .join("\n");
}

// ===== 主函式 =====
export async function generateSimulation(
  scene: SceneType,
  command: string,
  ctx: { subScene?: string; history?: SimulationEvent[]; relationships?: RelationshipLink[]; dmPair?: string[] }
): Promise<SimulationBlock> {
  const apiKey = getApiKey();
  if (!apiKey) throw new SimError("NO_KEY", ERROR_TEXT.NO_KEY);

  const personas = Object.values(PERSONA_DATA)
    .map(p => `- ${p.name}（${p.role}）：${p.traits} 說話：${p.speech} ${p.relationship}`)
    .join("\n");

  const rels = (ctx.relationships || [])
    .map(r => `- ${r.from} → ${r.to}：${r.type}（${r.level}%）${r.note}`)
    .join("\n");

  const system = `你是「BLUR GOD VIEW」模擬引擎，用上帝視角觀察虛擬女團 BLUR 的日常、舞台與綜藝。
世界觀：${WORLD_VIEW.concept}。音樂風格：${WORLD_VIEW.music_style}

成員：
${personas}

目前關係：
${rels || "（標準關係）"}

${sceneInstruction(scene, ctx.subScene || "", ctx.dmPair || [])}

規則：
- 一律使用台灣繁體中文與台灣用語（成員激動時可夾韓文）。
- 每位成員的說話方式要符合人設，不要每個人聽起來都一樣。
- 接續「前情」自然推進劇情，不要重複已經發生的事。
- 使用者給的指令是「神視干涉」：把它當成劇情裡發生的事件或方向，自然融入。
- 用 emit_block 工具輸出，不要輸出其他文字。`;

  const userMsg = `前情：
${historyText(ctx.history)}

神視干涉指令：${command.trim() || "（無，請自主推進下一段劇情）"}`;

  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: getModel(),
        max_tokens: 8000,
        system,
        tools: [EMIT_TOOL],
        tool_choice: { type: "tool", name: "emit_block" },
        messages: [{ role: "user", content: userMsg }],
      }),
    });
  } catch {
    throw new SimError("NETWORK", ERROR_TEXT.NETWORK);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const err = await res.json();
      detail = err?.error?.message || "";
    } catch { /* ignore */ }
    if (res.status === 401 || res.status === 403) throw new SimError("BAD_KEY", ERROR_TEXT.BAD_KEY);
    if (res.status === 429) throw new SimError("RATE", ERROR_TEXT.RATE);
    if (res.status === 529 || res.status === 503) throw new SimError("OVERLOAD", ERROR_TEXT.OVERLOAD);
    if (/credit|balance|billing/i.test(detail)) throw new SimError("NO_CREDIT", ERROR_TEXT.NO_CREDIT);
    throw new SimError("OTHER", `${ERROR_TEXT.OTHER}（${res.status}）${detail ? "：" + detail : ""}`);
  }

  const data = await res.json();
  const block = (data?.content || []).find((b: any) => b.type === "tool_use");
  const input = block?.input;
  if (!input || !Array.isArray(input.events)) throw new SimError("OTHER", "Claude 回傳的格式不完整，再按一次試試");

  const stamp = Date.now().toString(36);
  const events: SimulationEvent[] = input.events.map((ev: any, i: number) => ({
    eventId: `${stamp}-${i}`,
    ts: String(ev.ts || ""),
    eventType: ev.eventType || "message",
    participants: Array.isArray(ev.participants) ? ev.participants : [],
    content: {
      ...(ev.content || {}),
      replies: Array.isArray(ev.content?.replies)
        ? ev.content.replies.map((r: any, j: number) => ({ id: `${stamp}-${i}-${j}`, ...r }))
        : undefined,
    },
  }));

  return {
    sessionId: stamp,
    scene: { sceneId: stamp, sceneType: scene, locationLabel: String(input.locationLabel || ""), subScene: ctx.subScene },
    events,
  };
}
