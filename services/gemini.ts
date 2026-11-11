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

export type Lore = { group: string; members: Record<string, string> };


type Ctx = { subScene?: string; history?: SimulationEvent[]; relationships?: RelationshipLink[]; dmPair?: string[]; elsewhere?: string[]; lore?: Lore };

function buildSystem(sceneText: string, ctx: Ctx): string {
  const personas = Object.values(PERSONA_DATA)
    .map(p => {
      const extra = ctx.lore?.members?.[p.name]?.trim();
      return `- ${p.name}（${p.role}）：${p.traits} 說話：${p.speech} ${p.relationship}${extra ? `\n  補充設定：${extra}` : ""}`;
    })
    .join("\n");
  const groupLore = ctx.lore?.group?.trim();

  const rels = (ctx.relationships || [])
    .map(r => `- ${r.from} → ${r.to}：${r.type}（${r.level}%）${r.note}`)
    .join("\n");

  const system = `你是「BLUR GOD VIEW」模擬引擎，用上帝視角觀察虛擬女團 BLUR 的日常、舞台與綜藝。
世界觀：${WORLD_VIEW.concept}。音樂風格：${WORLD_VIEW.music_style}

${groupLore ? `團體現況與補充設定（以這裡為準）：\n${groupLore}\n\n` : ""}成員：
${personas}

目前關係：
${rels || "（標準關係）"}

${sceneText}

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

去 AI 味（同樣重要）：
- 不用「不是A，而是B」對舉句，不用「核心是：」「事實是：」這種先下結論的冒號句。
- 不用排比和三連並列；一句裡不要用頓號、分號串好幾件事；相鄰幾句不要同一個句型。
- 名詞前不掛一長串修飾語，「的」不要連用。同一樣東西就用同一個詞，不要為了變化輪換同義詞。
- 破折號少用。比喻只在真的貼切時用，不要硬套宏大意象、不要翻譯腔、不要公式化的情緒描寫（「心中湧起一股暖流」「眼眶微微泛紅」）。
- 不要刻意把句子拆短或拉長製造節奏，照人物和情境自然說話；正常的文學表達可以保留。
- 保留既有人物設定、時間線、產業背景和感情發展，前後連貫。
- 只輸出符合格式的 JSON。`;
  return system;
}

async function callApi(system: string, userMsg: string, schema: unknown): Promise<any> {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ system, prompt: userMsg, schema }),
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error)?.name === "AbortError") throw new SimError("OVERLOAD", "等太久沒回應，再按一次試試");
    throw new SimError("NETWORK", ERROR_TEXT.NETWORK);
  }
  clearTimeout(timer);

  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }

  if (!res.ok) {
    const code = (data?.code || "OTHER") as SimErrorCode;
    const text = ERROR_TEXT[code] && code !== "OTHER" ? ERROR_TEXT[code] : `${ERROR_TEXT.OTHER}：${data?.message || res.status}`;
    throw new SimError(code in ERROR_TEXT ? code : "OTHER", text);
  }

  let input: any = null;
  try { input = JSON.parse(data?.text || ""); } catch { /* ignore */ }
  if (!input) throw new SimError("OTHER", "回傳的格式不完整，再按一次試試");
  return input;

}

// ===== 主函式 =====
export type { Ctx };
export async function generateSimulation(
  scene: SceneType,
  command: string,
  ctx: Ctx
): Promise<SimulationBlock> {
  const system = buildSystem(sceneInstruction(scene, ctx.subScene || "", ctx.dmPair || []), ctx);

  const elsewhere = (ctx.elsewhere || []).length ? ctx.elsewhere!.join("\n") : "（無）";

  const userMsg = `其他場景最近發生的事：
${elsewhere}

這個場景的前情：
${historyText(ctx.history)}

神視干涉指令：${command.trim() || "（無，請自主推進下一段劇情）"}`;

  const input = await callApi(system, userMsg, GEMINI_SCHEMA);
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

// ===== 論壇（仿 theqoo）=====
const REPLY_SCHEMA = {
  type: "object",
  properties: {
    author: { type: "string", description: "匿名暱稱，例如：匿名的BLUR粉、路過的、某個推Nanae的" },
    text: { type: "string" },
    type: { type: "string", enum: ["fan", "hater", "neutral", "shipper", "mom_fan"] },
    to: { type: "integer", description: "回覆第幾樓留言；不是回覆別人就填 0" },
  },
  required: ["author", "text", "type"],
};
const LIST_SCHEMA = toGeminiSchema({
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          text: { type: "string" },
          views: { type: "integer" },
          replies: { type: "array", items: REPLY_SCHEMA },
        },
        required: ["title", "text", "replies"],
      },
    },
  },
  required: ["posts"],
});
const REPLIES_SCHEMA = toGeminiSchema({
  type: "object",
  properties: { replies: { type: "array", items: REPLY_SCHEMA } },
  required: ["replies"],
});

const FORUM_STYLE = `論壇風格參考韓國 theqoo：匿名、短句、口語、愛用梗和縮寫（ㅋㅋ、ㅠㅠ、真的瘋了、我先哭），會貼「[截圖]」「[動圖]」描述，標題常帶【】或 (+)、(*分析)。
留言要像真人在吵、在笑、在接梗：有人只回一個字、有人長篇分析、有人歪樓、有人回覆特定樓層，黑粉和理性粉會互嗆。不要每則留言都在誇。`;

const mkReplies = (arr: any[], stamp: string) =>
  (Array.isArray(arr) ? arr : []).map((r: any, j: number) => ({
    id: `${stamp}-${j}`, author: String(r.author || "匿名"), text: String(r.text || ""),
    type: r.type || "neutral", to: Number(r.to) || 0,
  }));

const postText = (p: SimulationEvent) => {
  const c = p.content || {};
  const rs = (c.replies || []).slice(-30).map((r: any, i: number) => `${i + 1}樓 ${r.author}${r.mine ? "（樓主本人/使用者）" : ""}：${r.text}`).join("\n");
  return `標題：${c.title}\n作者：${c.speaker}${(c as any).mine ? "（使用者本人）" : ""}\n內文：${c.text}\n\n留言：\n${rs || "（還沒有）"}`;
};

// 別人的新文章（或使用者自己發的文章）
export async function generateForumPosts(
  board: string, ctx: Ctx, existing: SimulationEvent[], mine?: { title: string; text: string }
): Promise<SimulationEvent[]> {
  const scene = mine
    ? `場景：粉絲論壇【${board}】。使用者剛發了一篇文，請只輸出 1 篇 post（標題和內文照使用者寫的原樣），並產生 6–15 則其他網友的留言反應。`
    : `場景：粉絲論壇【${board}】。產生 5 篇不同網友的新文章，題材要分散（舞台、私下互動、八卦、梗圖、爭議、求問），內容呼應其他場景最近發生的事。每篇附 3–15 則留言，views 填合理的瀏覽數。`;
  const system = buildSystem(scene + "\n" + FORUM_STYLE, ctx);
  const titles = existing.slice(-15).map(p => p.content?.title).filter(Boolean).join("、");
  const userMsg = `其他場景最近發生的事：\n${(ctx.elsewhere || []).join("\n") || "（無）"}\n\n板上已經有的文章（不要重複）：${titles || "（無）"}${
    mine ? `\n\n使用者的文章：\n標題：${mine.title}\n內文：${mine.text}` : ""}`;
  const out = await callApi(system, userMsg, LIST_SCHEMA);
  const posts = Array.isArray(out?.posts) ? out.posts : [];
  if (!posts.length) throw new SimError("OTHER", "回傳的格式不完整，再按一次試試");
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return posts.map((p: any, i: number) => {
    const stamp = `${Date.now().toString(36)}${i}`;
    return {
      eventId: stamp, ts: hhmm, eventType: "forum_post", participants: [],
      content: {
        title: mine ? mine.title : String(p.title || ""), text: mine ? mine.text : String(p.text || ""),
        speaker: mine ? "我" : "匿名的BLUR粉", board,
        replies: mkReplies(p.replies, stamp),
        views: mine ? 1 : Number(p.views) || Math.floor(200 + Math.random() * 3000),
        likes: mine ? 0 : Math.floor(Math.random() * 60), mine: !!mine,
      } as any,
    };
  });
}

// 使用者留言後，其他網友的反應（或打開沒什麼留言的文章時補留言）
export async function generateForumReplies(board: string, ctx: Ctx, post: SimulationEvent, myComment?: string) {
  const scene = `場景：粉絲論壇【${board}】的一篇文章底下。${
    myComment ? "使用者剛留了最後一則留言，產生 3–8 則新留言：有人直接回覆使用者（to 填使用者那樓的樓層），也有人繼續原本的話題。" : "產生 4–10 則新留言，接續現有討論。"}`;
  const system = buildSystem(scene + "\n" + FORUM_STYLE, ctx);
  const out = await callApi(system, postText(post), REPLIES_SCHEMA);
  return mkReplies(out?.replies, Date.now().toString(36));
}
