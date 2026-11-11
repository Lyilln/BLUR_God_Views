import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageCircle, Home, Mic, Newspaper, Users, Settings as SettingsIcon, RotateCcw,
  ArrowUp, Loader2, Sparkles, Eye, EyeOff, X, Plus, Trash2, Play, Clapperboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SceneType, SimulationEvent, RelationshipLink } from './types';
import { PERSONA_DATA, INITIAL_RELATIONSHIPS, MUSIC_SHOWS, VARIETY_SHOWS, FORUM_BOARDS, MEMBER_COLORS } from './constants';
import { generateSimulation, SimError, ERROR_TEXT, getApiKey, setApiKey } from './services/gemini';

// ===== 設定 =====
type Tab = 'chat' | 'daily' | 'show' | 'forum' | 'map';

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; scenes: SceneType[] }[] = [
  { id: 'chat', label: '聊天', icon: MessageCircle, scenes: ['group_chat', 'dm'] },
  { id: 'daily', label: '日常', icon: Home, scenes: ['practice_room', 'dorm', 'studio', 'company'] },
  { id: 'show', label: '舞台', icon: Mic, scenes: ['stage', 'variety'] },
  { id: 'forum', label: '論壇', icon: Newspaper, scenes: ['forum'] },
  { id: 'map', label: '關係', icon: Users, scenes: ['relationship_map'] },
];

const SCENE_LABELS: Record<SceneType, string> = {
  group_chat: '團體聊天室', dm: '私訊', practice_room: '練習室', dorm: '宿舍',
  studio: '錄音室', company: '經紀公司', stage: '打歌舞台', variety: '綜藝',
  forum: '粉絲論壇', relationship_map: '關係圖譜',
};

const SUB_OPTIONS: Partial<Record<SceneType, string[]>> = {
  stage: MUSIC_SHOWS, variety: VARIETY_SHOWS, forum: FORUM_BOARDS,
};

const REPLY_LABEL: Record<string, string> = {
  fan: '理性粉', hater: '黑粉', neutral: '路人', shipper: 'CP粉', mom_fan: '媽媽粉',
};

const MEMBERS = Object.keys(PERSONA_DATA);
const MAP_SIZE = 340;
const MAP_R = 118;

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch { return fallback; }
};
const save = (key: string, v: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 容量滿或私密模式 */ }
};

const initialNodes = () => {
  const out: Record<string, { x: number; y: number }> = {};
  MEMBERS.forEach((n, i) => {
    const a = (i / MEMBERS.length) * Math.PI * 2 - Math.PI / 2;
    out[n] = { x: Math.cos(a) * MAP_R, y: Math.sin(a) * MAP_R };
  });
  return out;
};

// ===== 小元件 =====
function Avatar({ name, size }: { name?: string; size?: 'xs' | 'lg' }) {
  const c = name ? MEMBER_COLORS[name] : undefined;
  return (
    <div
      className={`av ${size || ''} ${c ? '' : 'npc'}`}
      style={c ? { background: `linear-gradient(135deg, ${c[0]}, ${c[1]})` } : undefined}
    >
      {(name || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="sheet"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          >
            <div className="grab" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ===== 主程式 =====
export default function App() {
  const [tab, setTab] = useState<Tab>('chat');
  const [tabScene, setTabScene] = useState<Record<Tab, SceneType>>({
    chat: 'group_chat', daily: 'practice_room', show: 'stage', forum: 'forum', map: 'relationship_map',
  });
  const [subScenes, setSubScenes] = useState<Partial<Record<SceneType, string>>>({});
  const [dmPair, setDmPair] = useState<string[]>(['Chloe', 'RAHI']);
  const [history, setHistory] = useState<Record<string, SimulationEvent[]>>(() => load('blur_v8_history', {}));
  const [relationships, setRelationships] = useState<RelationshipLink[]>(() => load('blur_v8_rel', INITIAL_RELATIONSHIPS));
  const [nodes, setNodes] = useState(() => load('blur_v9_nodes', initialNodes()));
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(() => !!getApiKey());

  const [relEdit, setRelEdit] = useState<{ index: number; draft: RelationshipLink } | null>(null);

  const feedRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ name: string; sx: number; sy: number; ox: number; oy: number } | null>(null);

  const scene = tabScene[tab];
  const subScene = subScenes[scene] || SUB_OPTIONS[scene]?.[0] || '';
  const historyKey = scene === 'dm' ? `dm:${[...dmPair].sort().join('-')}` : (subScene || scene);
  const events = history[historyKey] || [];
  const isChat = scene === 'group_chat' || scene === 'dm';

  // 儲存
  useEffect(() => save('blur_v8_history', history), [history]);
  useEffect(() => save('blur_v8_rel', relationships), [relationships]);
  useEffect(() => save('blur_v9_nodes', nodes), [nodes]);

  // 新內容自動捲到底
  useEffect(() => {
    const el = feedRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [events.length, busy, historyKey]);

  // toast 自動消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const openSettings = useCallback(() => {
    setKeyDraft(getApiKey());
    setShowKey(false);
    setSettingsOpen(true);
  }, []);

  const saveSettings = () => {
    setApiKey(keyDraft);
    setHasKey(!!keyDraft.trim());
    setSettingsOpen(false);
    setToast({ text: keyDraft.trim() ? '設定已儲存' : '已清除 API Key' });
  };

  const run = useCallback(async (custom?: string) => {
    if (busy || scene === 'relationship_map') return;
    if (!getApiKey()) {
      setToast({ text: ERROR_TEXT.NO_KEY, action: { label: '去設定', run: openSettings } });
      return;
    }
    const cmd = custom ?? command;
    setBusy(true);
    setCommand('');
    try {
      const block = await generateSimulation(scene, cmd, {
        subScene, history: history[historyKey], relationships, dmPair: scene === 'dm' ? dmPair : undefined,
      });
      const add: SimulationEvent[] = [];
      if (!isChat && block.scene.locationLabel) {
        add.push({
          eventId: `${block.sessionId}-loc`, ts: '', eventType: 'scene_change', participants: [],
          content: { text: block.scene.locationLabel },
        });
      }
      add.push(...block.events);
      setHistory(p => ({ ...p, [historyKey]: [...(p[historyKey] || []), ...add] }));
    } catch (e) {
      console.error(e);
      setCommand(cmd);
      if (e instanceof SimError) {
        const needSettings = e.code === 'NO_KEY' || e.code === 'BAD_KEY';
        setToast({ text: e.message, action: needSettings ? { label: '去設定', run: openSettings } : undefined });
      } else {
        setToast({ text: `生成失敗：${String((e as Error)?.message || e).slice(0, 80)}` });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, scene, command, subScene, history, historyKey, relationships, dmPair, isChat, openSettings]);

  const clearScene = () => {
    if (!events.length) return;
    if (!window.confirm(`清空「${subScene || SCENE_LABELS[scene]}」的所有紀錄？`)) return;
    setHistory(p => {
      const next = { ...p };
      delete next[historyKey];
      return next;
    });
  };

  const toggleDm = (name: string) => {
    setDmPair(p => p.includes(name) ? (p.length > 1 ? p.filter(n => n !== name) : p) : p.length < 2 ? [...p, name] : [p[1], name]);
  };

  // ===== 關係圖拖曳 =====
  const onNodeDown = (name: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { name, sx: e.clientX, sy: e.clientY, ox: nodes[name].x, oy: nodes[name].y };
  };
  const onNodeMove = (name: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.name !== name) return;
    const lim = MAP_SIZE / 2 - 30;
    const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
    setNodes(p => ({ ...p, [name]: { x: clamp(d.ox + e.clientX - d.sx), y: clamp(d.oy + e.clientY - d.sy) } }));
  };
  const onNodeUp = () => { dragRef.current = null; };

  const saveRel = () => {
    if (!relEdit) return;
    const { index, draft } = relEdit;
    if (draft.from === draft.to) { setToast({ text: '兩端不能是同一個人' }); return; }
    setRelationships(p => index < 0 ? [...p, draft] : p.map((r, i) => (i === index ? draft : r)));
    setRelEdit(null);
  };
  const deleteRel = () => {
    if (!relEdit || relEdit.index < 0) return;
    setRelationships(p => p.filter((_, i) => i !== relEdit.index));
    setRelEdit(null);
  };

  // ===== 事件渲染 =====
  const renderEvent = (ev: SimulationEvent, prev?: SimulationEvent) => {
    const c = ev.content || {};

    if (ev.eventType === 'scene_change' || ev.eventType === 'system_note') {
      return ev.eventType === 'scene_change'
        ? <div className="loc"><Clapperboard size={13} />{c.text}</div>
        : <div className="note">{c.text || c.action}</div>;
    }

    if (ev.eventType === 'forum_post') {
      return (
        <div className="card">
          <div className="post-h">
            <span className="pill v">{c.board || subScene}</span>
            <span className="post-meta">{c.speaker || '匿名'} · {ev.ts}</span>
          </div>
          <h3 className="post-title">{c.title}</h3>
          <div className="card-t">{c.text}</div>
          {!!c.replies?.length && (
            <div className="replies">
              {c.replies.map((r, i) => (
                <div className="reply" key={r.id || i}>
                  <div className="reply-h">
                    {r.author}
                    <span className={`tag ${r.type}`}>{REPLY_LABEL[r.type] || r.type}</span>
                  </div>
                  <p>{r.text}</p>
                </div>
              ))}
            </div>
          )}
          <button className="link-btn" onClick={() => setCommand(`我在這篇底下回覆：「${c.title}」`)}>
            <Plus size={14} /> 我也要回覆
          </button>
        </div>
      );
    }

    if (isChat && c.text) {
      const cont = prev?.content?.speaker === c.speaker && prev?.eventType === 'message';
      return (
        <div className={`msg ${cont ? 'cont' : ''}`}>
          <Avatar name={c.speaker} />
          <div className="msg-b">
            <div className="msg-n">{c.speaker}<time>{ev.ts}</time></div>
            <div className="bubble">{c.text}</div>
          </div>
        </div>
      );
    }

    const isPerformance = c.stage_phase === '舞台表演';
    return (
      <div className="card">
        {(c.speaker || c.stage_phase) && (
          <div className="card-h">
            {c.speaker && <Avatar name={c.speaker} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              {c.speaker && <b>{c.speaker}</b>}
              {ev.ts && <small> · {ev.ts}</small>}
            </div>
            {c.stage_phase && <span className={`pill ${isPerformance ? 'g' : 'v'}`}>{c.stage_phase}</span>}
            {c.variety_persona && <span className="pill y">{c.variety_persona}</span>}
          </div>
        )}
        {c.text && <div className="card-t">{c.text}</div>}
        {c.action && <div className="act">{c.action}</div>}
        {c.detail && <div className="caption">{c.detail}</div>}
        {isPerformance && (c.outfit || c.camera || c.lighting || c.choreography) && (
          <>
            <div className="stage-grid">
              {c.outfit && <div><span>STYLING</span>{c.outfit}</div>}
              {c.lighting && <div><span>LIGHTING</span>{c.lighting}</div>}
              {c.camera && <div className="full"><span>CAMERA</span>{c.camera}</div>}
              {c.choreography && <div className="full"><span>CHOREO</span>{c.choreography}</div>}
            </div>
            <button className="link-btn" onClick={() => run(`重播這段舞台的高光時刻，換一個機位：${(c.text || '').slice(0, 60)}`)}>
              <Play size={14} /> 換機位重看
            </button>
          </>
        )}
      </div>
    );
  };

  const placeholder =
    scene === 'forum' ? '用匿名粉絲身分發文或丟話題…'
      : isChat ? '丟一個話題或事件進聊天室…'
        : '下達神視干涉指令…';

  const tabDef = TABS.find(t => t.id === tab)!;

  // ===== 畫面 =====
  return (
    <div className={`app ${scene === 'stage' ? 'dark-stage' : ''}`}>
      {/* 頂部 */}
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <b>BLUR</b>
            <small>{SCENE_LABELS[scene]}{scene === 'dm' ? ` · ${dmPair.join(' × ')}` : subScene ? ` · ${subScene}` : ''}</small>
          </div>
          <div className="top-btns">
            {tab !== 'map' && (
              <button className="ibtn glass" onClick={clearScene} aria-label="清空本頁紀錄" title="清空本頁紀錄">
                <RotateCcw size={18} />
              </button>
            )}
            <button className={`ibtn glass ${hasKey ? '' : 'dot'}`} onClick={openSettings} aria-label="設定" title="設定">
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>

        {tabDef.scenes.length > 1 && (
          <div className="chips">
            {tabDef.scenes.map(s => (
              <button key={s} className={`chip ${scene === s ? 'on' : ''}`} onClick={() => setTabScene(p => ({ ...p, [tab]: s }))}>
                {SCENE_LABELS[s]}
              </button>
            ))}
          </div>
        )}

        {SUB_OPTIONS[scene] && (
          <div className="chips">
            {SUB_OPTIONS[scene]!.map(o => (
              <button key={o} className={`chip sm ghost ${subScene === o ? 'on' : ''}`} onClick={() => setSubScenes(p => ({ ...p, [scene]: o }))}>
                {o}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* 內容 */}
      {tab === 'map' ? (
        <div className="map-wrap" key="map">
          <div className="map">
            <svg width={MAP_SIZE} height={MAP_SIZE}>
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#7FE3D6" />
                  <stop offset=".55" stopColor="#8E72F0" />
                  <stop offset="1" stopColor="#E58AC0" />
                </linearGradient>
              </defs>
              {relationships.map((r, i) => {
                const a = nodes[r.from], b = nodes[r.to];
                if (!a || !b) return null;
                const cx = MAP_SIZE / 2;
                const x1 = cx + a.x, y1 = cx + a.y, x2 = cx + b.x, y2 = cx + b.y;
                // 微彎曲線，避免雙向關係重疊
                const mx = (x1 + x2) / 2 - (y2 - y1) * 0.15, my = (y1 + y2) / 2 + (x2 - x1) * 0.15;
                return (
                  <path
                    key={i} d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none"
                    stroke="url(#lg)" strokeLinecap="round" strokeOpacity={0.35 + r.level / 200}
                    strokeWidth={1.5 + r.level / 25}
                  />
                );
              })}
            </svg>
            {MEMBERS.map(n => (
              <div
                key={n} className="node"
                style={{ transform: `translate(${MAP_SIZE / 2 + nodes[n].x}px, ${MAP_SIZE / 2 + nodes[n].y}px) translate(-50%, -28px)` }}
                onPointerDown={onNodeDown(n)} onPointerMove={onNodeMove(n)} onPointerUp={onNodeUp} onPointerCancel={onNodeUp}
              >
                <Avatar name={n} size="lg" />
                <span>{n}</span>
              </div>
            ))}
          </div>

          <div className="rel-list">
            {relationships.map((r, i) => (
              <button key={i} className="rel" onClick={() => setRelEdit({ index: i, draft: { ...r } })}>
                <div className="rel-pair"><Avatar name={r.from} size="xs" /><Avatar name={r.to} size="xs" /></div>
                <div className="rel-b">
                  <b>{r.from} → {r.to}・{r.type}</b>
                  <small>{r.note}</small>
                </div>
                <div className="meter"><i style={{ width: `${r.level}%` }} /></div>
                <span className="lvl">{r.level}%</span>
              </button>
            ))}
            <button
              className="btn soft"
              onClick={() => setRelEdit({ index: -1, draft: { from: MEMBERS[0], to: MEMBERS[1], type: '', level: 60, note: '' } })}
            >
              <Plus size={18} /> 新增關係
            </button>
          </div>
        </div>
      ) : (
        <div className="feed" key="feed" ref={feedRef}>
          <div className="feed-in">
            {events.length === 0 && !busy && (
              <div className="empty">
                <div className="empty-ic"><Sparkles size={32} /></div>
                <b>{subScene || SCENE_LABELS[scene]}還很安靜</b>
                <p>按下開始觀測，或在下面輸入你想讓她們發生的事。</p>
                <button className="btn" onClick={() => run('')}><Eye size={18} /> 開始觀測</button>
              </div>
            )}
            <AnimatePresence initial={false}>
              {events.map((ev, i) => (
                <motion.div
                  key={ev.eventId || i}
                  initial={{ opacity: 0, y: 14, scale: .98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', damping: 24, stiffness: 260, delay: Math.min(i % 12, 8) * 0.03 }}
                  style={{ display: 'flex', flexDirection: 'column' }}
                >
                  {renderEvent(ev, events[i - 1])}
                </motion.div>
              ))}
            </AnimatePresence>
            {busy && (
              <div className="typing">
                <Avatar />
                <div className="bubble"><i /><i /><i /></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 輸入列 */}
      {tab !== 'map' && (
        <div className="composer">
          {scene === 'dm' && (
            <div className="dm-pick">
              {MEMBERS.map(n => (
                <button key={n} className={dmPair.includes(n) ? 'on' : ''} onClick={() => toggleDm(n)}>
                  <Avatar name={n} size="xs" />{n}
                </button>
              ))}
            </div>
          )}
          <div className="c-row glass">
            <input
              value={command}
              onChange={e => setCommand(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) run(); }}
              placeholder={placeholder}
              enterKeyHint="send"
            />
            <button className="send" onClick={() => run()} disabled={busy} aria-label="生成">
              {busy ? <Loader2 size={20} className="spin" /> : <ArrowUp size={20} strokeWidth={2.6} />}
            </button>
          </div>
        </div>
      )}

      {/* 液態玻璃導覽列 */}
      <nav className="nav">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {tab === t.id && <motion.div layoutId="lens" className="lens" transition={{ type: 'spring', damping: 22, stiffness: 300 }} />}
              <Icon size={21} strokeWidth={tab === t.id ? 2.4 : 2} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 設定 */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)}>
        <h3>設定 <button className="ibtn" onClick={() => setSettingsOpen(false)} aria-label="關閉"><X size={20} /></button></h3>
        <p className="sub">Key 只存在這支手機的瀏覽器裡，只會直接送給 Google，不經過其他地方。</p>

        <div className="field">
          <label>Gemini API Key</label>
          <div className="inp">
            <input
              type={showKey ? 'text' : 'password'} value={keyDraft} onChange={e => setKeyDraft(e.target.value)}
              placeholder="AIza…" autoComplete="off" spellCheck={false}
            />
            <button className="ibtn" onClick={() => setShowKey(v => !v)} aria-label={showKey ? '隱藏' : '顯示'}>
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <span className="hint">
            到 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> 免費建立 Key，不用綁卡。會自動使用免費模型，一個額度用完就換下一個。
          </span>
        </div>

        <button className="btn" style={{ width: '100%' }} onClick={saveSettings}>儲存</button>
      </Sheet>

      {/* 編輯關係 */}
      <Sheet open={!!relEdit} onClose={() => setRelEdit(null)}>
        {relEdit && (
          <>
            <h3>{relEdit.index < 0 ? '新增關係' : '編輯關係'} <button className="ibtn" onClick={() => setRelEdit(null)} aria-label="關閉"><X size={20} /></button></h3>
            <p className="sub">改完之後，下一輪生成就會照新的關係演。</p>
            <div className="row">
              {(['from', 'to'] as const).map(k => (
                <div className="field" key={k}>
                  <label>{k === 'from' ? '誰' : '對誰'}</label>
                  <div className="inp">
                    <select value={relEdit.draft[k]} onChange={e => { const v = e.target.value; setRelEdit(r => r && ({ ...r, draft: { ...r.draft, [k]: v } })); }}>
                      {MEMBERS.map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <div className="field">
              <label>關係類型</label>
              <div className="inp">
                <input value={relEdit.draft.type} placeholder="例如：靈魂伴侶" onChange={e => { const v = e.target.value; setRelEdit(r => r && ({ ...r, draft: { ...r.draft, type: v } })); }} />
              </div>
            </div>
            <div className="field">
              <label>親密度 {relEdit.draft.level}%</label>
              <input type="range" min={0} max={100} value={relEdit.draft.level}
                onChange={e => { const v = Number(e.target.value); setRelEdit(r => r && ({ ...r, draft: { ...r.draft, level: v } })); }} />
            </div>
            <div className="field">
              <label>細節</label>
              <textarea className="ta" value={relEdit.draft.note} placeholder="這段關係的小細節…"
                onChange={e => { const v = e.target.value; setRelEdit(r => r && ({ ...r, draft: { ...r.draft, note: v } })); }} />
            </div>
            <div className="row">
              {relEdit.index >= 0 && <button className="btn danger" onClick={deleteRel}><Trash2 size={17} /> 刪除</button>}
              <button className="btn" onClick={saveRel}>儲存</button>
            </div>
          </>
        )}
      </Sheet>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: -16, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: -16, x: '-50%' }}>
            <span>{toast.text}</span>
            {toast.action && <button onClick={() => { toast.action!.run(); setToast(null); }}>{toast.action.label}</button>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
