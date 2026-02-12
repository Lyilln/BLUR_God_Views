
export const PERSONA_DATA = {
  Chloe: { name: 'Chloe', role: 'Rapper / Vocal', traits: '高冷臉、語速極快、邏輯強、遊戲大神。', speech: '語速快、激動時冒韓語。', relationship: '最黏 RAHI。' },
  Nanae: { name: 'Nanae', role: '主舞', traits: '172cm、舞台霸氣下台省電、呆萌 lag。', speech: '慢半拍、呆萌。', relationship: '被全體寵愛。' },
  Yeongri: { name: 'Yeongri', role: '隊長 / 門面', traits: '175cm、效率控、軍隊式管理、怕鬼。', speech: '命令式、簡短有力。', relationship: '守護 Sera。' },
  RAHI: { name: 'RAHI', role: '忙內 / Rap', traits: '14歲巨型寶寶、惡作劇之王、四次元。', speech: 'mumbling rap。', relationship: '逆子忙內。' },
  Sera: { name: 'Sera', role: '大姐 / Vocal', traits: '溫柔堅韌、眼淚女王、香菜愛好者。', speech: '感性、溫柔。', relationship: '照顧大家情緒。' }
};

export const MUSIC_SHOWS = [
  'M Countdown', 'Music Bank', 'Inkigayo', 'Show! Music Core', 'Show Champion'
];

export const VARIETY_SHOWS = [
  'Running Man', 'Knowing Bros', 'Amazing Saturday', 'I Live Alone', 'Radio Star', 
  '2 Days & 1 Night', 'King of Mask Singer', 'Weekly Idol', 'Idol Human Theater', 
  'MMTG', 'Yoo Quiz on the Block', 'The Manager'
];

export const FORUM_BOARDS = [
  '回歸討論', '舞台截圖/彩蛋分析', '成員關係學/互動糖點', '謠言澄清', '路人感想', '搞笑meme/梗圖'
];

export const INITIAL_RELATIONSHIPS: any[] = [
  { from: 'Chloe', to: 'RAHI', type: '靈魂伴侶', level: 95, note: '共同搗蛋小隊' },
  { from: 'Yeongri', to: 'Sera', type: '互補搭檔', level: 90, note: '隊內的雙親' },
  { from: 'Nanae', to: 'Yeongri', type: '敬畏', level: 85, note: '隊長的小跟班' },
  { from: 'RAHI', to: 'Nanae', type: '巨型寶寶', level: 92, note: 'Nanae 的人體掛件' },
  { from: 'Sera', to: 'Chloe', type: '心理諮商', level: 88, note: '聽 Chloe 抱怨的人' },
];

export const WORLD_VIEW = {
  concept: '夢幻、空靈、優雅、黑暗、反叛',
  music_style: '「空靈的叛亂」：古典架構揉合工業噪音。'
};
