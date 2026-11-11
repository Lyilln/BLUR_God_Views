import { SimulationBlock, SimulationEvent, SceneType, RelationshipLink } from "../types";
import { PERSONA_DATA, WORLD_VIEW } from "../constants";

// ===== 後端網址（Supabase Edge Function；Gemini Key 存在後端，網站上看不到）=====
export const API_URL = "https://hzjhzhxgeuchpyxhsbgj.supabase.co/functions/v1/blur-generate";

// ===== 錯誤 =====
export type SimErrorCode = "NO_KEY" | "BAD_KEY" | "RATE" | "OVERLOAD" | "NETWORK" | "OTHER";

export class SimError extends Error {
  code: SimErrorCode;
  constructor(code: SimErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export const ERROR_TEXT: Record<SimErrorCode, string> = {
  NO_KEY: "後端還沒設定 Gemini Key",
  BAD_KEY: "後端的 Gemini Key 無效，請到 Supabase 重新設定",
  RATE: "免費額度暫時用完了，等一分鐘再試；如果是今天的量用完，明天會重置",
  OVERLOAD: "Gemini 現在忙線中，稍後再試",
  NETWORK: "網路連線失敗，檢查一下網路",
  OTHER: "生成失敗",
};

// ===== 輸出格式（JSON Schema，送出前轉成 Gemini 的格式）=====
const OUTPUT_SCHEMA = {
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
};

// Gemini 的 responseSchema 用大寫型別
function toGeminiSchema(node: any): any {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: any = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "properties") out.properties = Object.fromEntries(Object.entries(v as any).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else out[k] = toGeminiSchema(v);
  }
  return out;
}
const GEMINI_SCHEMA = toGeminiSchema(OUTPUT_SCHEMA);

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
      return `場景：SM 式經紀公司（走廊、經紀人座位或會議室）。工作人員只用職稱（A&R、經紀人、室長）。
要有一件具體的公事：企劃案被退、行程撞期、數據出來了、某人被單獨叫進會議室……呈現職場階級與壓力。產生 6–10 個事件。`;
    case "group_chat":
      return `場景：成員的團體聊天室（手機訊息）。
嚴格規定：只有訊息文字，不描述動作或內心。每則訊息一個 message 事件，產生 8–16 則。
要像真的聊天室：有人已讀不回、有人連傳三則、有人回錯話題、有人突然丟照片描述「[照片] 冰箱裡被吃掉一半的布丁」。`;
    case "dm":
      return `場景：${dmPair.length === 2 ? `${dmPair[0]} 和 ${dmPair[1]}` : "兩位成員"}之間的私訊。
嚴格規定：只有這兩人，只有訊息文字，不描述動作或內心。產生 8–16 則 message 事件。
私訊裡會講在群組不會講的話：抱怨、秘密、撒嬌、道歉、只有兩人懂的梗。`;
    case "practice_room":
      return `場景：練習室。寫出練的是哪一段、哪個動作卡住、鏡子裡看到什麼、誰的體力先撐不住。動作描寫放 content.action，對話放 text。產生 6–10 個事件。`;
    case "dorm":
      return `場景：宿舍。寫出在哪個房間、桌上有什麼、誰在做什麼（洗衣服、搶浴室、偷吃別人的零食…）。動作描寫放 content.action，對話放 text。產生 6–10 個事件。`;
    case "studio":
      return `場景：錄音室。有製作人與錄音師（只用職稱）。寫出錄的是哪一句、卡在哪個音、製作人具體的修改要求、重錄第幾次。動作描寫放 content.action。產生 6–10 個事件。`;
    default:
      return "";
  }
}

function historyText(history: SimulationEvent[] | undefined): string {
  const recent = (history || []).slice(-24);
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

function nowText(): string {
  const d = new Date();
  const w = "日一二三四五六"[d.getDay()];
  const hh = d.getHours();
  const part = hh < 5 ? "深夜" : hh < 11 ? "早上" : hh < 14 ? "中午" : hh < 18 ? "下午" : hh < 22 ? "晚上" : "深夜";
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日（週${w}）${part} ${String(hh).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}。時間戳記與場景氣氛要符合這個時段。`;
}

// ===== 主函式 =====
export async function generateSimulation(
  scene: SceneType,
  command: string,
  ctx: { subScene?: string; history?: SimulationEvent[]; relationships?: RelationshipLink[]; dmPair?: string[]; elsewhere?: string[] }
): Promise<SimulationBlock> {
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

現在時間：${nowText()}

規則：
- 一律使用台灣繁體中文與台灣用語（成員激動時可夾韓文）。
- 接續「前情」推進，不要重複已經發生的事；「其他場景最近發生的事」是同一個世界，可以被提起、延續或造成影響。
- 使用者給的指令是「神視干涉」：把它當成劇情裡發生的事件或方向，自然融入，不要照抄指令文字。

寫作要求（最重要）：
- 每一輪一定要有一件具體的事發生：小衝突、意外、秘密被發現、計畫出包、突如其來的好消息或壞消息。不能只是打招呼、閒聊、互相加油。
- 細節要具體：寫出確切的物品、食物、品牌類型、時間、數字、歌詞段落、動作名稱。不要用「很多」「一些」「大家」「各種」帶過。
- 個性用行為和台詞演出來，禁止直接寫人設標籤，例如「呆萌地說」「霸氣地」「溫柔地笑了」。
- 對話要互相接話、有潛台詞、有人不配合；不要每個人輪流講一句感想。
- 不需要五個人都出場。兩三個人有戲，比五個人各講一句好。
- 禁止空泛收尾：「大家相視而笑」「氣氛很溫馨」「這就是她們的日常」「感情越來越好」這類句子一律不要寫。結尾停在一個動作、一句台詞或一個懸念。
- 只輸出符合格式的 JSON。`;

  const elsewhere = (ctx.elsewhere || []).length ? ctx.elsewhere!.join("\n") : "（無）";

  const userMsg = `其他場景最近發生的事：
${elsewhere}

這個場景的前情：
${historyText(ctx.history)}

神視干涉指令：${command.trim() || "（無，請自主推進下一段劇情）"}`;

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system, prompt: userMsg, schema: GEMINI_SCHEMA }),
    });
  } catch {
    throw new SimError("NETWORK", ERROR_TEXT.NETWORK);
  }

  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    const code = (data?.code || "OTHER") as SimErrorCode;
    const text = ERROR_TEXT[code] && code !== "OTHER" ? ERROR_TEXT[code] : `${ERROR_TEXT.OTHER}：${data?.message || res.status}`;
    throw new SimError(code in ERROR_TEXT ? code : "OTHER", text);
  }

  let input: any = null;
  try { input = JSON.parse(data?.text || ""); } catch { /* ignore */ }
  if (!input || !Array.isArray(input.events)) throw new SimError("OTHER", "回傳的格式不完整，再按一次試試");

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
