import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Heart, ArrowUp, Radio, Eye, Plus, Square, Loader2, ChevronDown } from 'lucide-react';
import { generateLiveSegment, LiveSession, LiveLine, Ctx, SimError } from '../services/gemini';
import { MEMBER_COLORS } from '../constants';

type Props = {
  sessions: LiveSession[];
  setSessions: (fn: (p: LiveSession[]) => LiveSession[]) => void;
  members: string[];
  makeCtx: () => Ctx;
  toast: (t: string) => void;
};

const MAX_AUTO = 12; // 不留言的情況下最多自動接幾段，省免費額度

const fmt = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}萬` : n.toLocaleString('en-US'));
const dur = (a: number, b?: number) => {
  const m = Math.max(1, Math.round(((b || Date.now()) - a) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)} 小時 ${m % 60} 分` : `${m} 分鐘`;
};
const grad = (n: string) => {
  const c = MEMBER_COLORS[n];
  return c ? `linear-gradient(135deg, ${c[0]}, ${c[1]})` : 'linear-gradient(135deg,#C4B5FD,#8E72F0)';
};

export default function Live({ sessions, setSessions, members, makeCtx, toast }: Props) {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [chat, setChat] = useState('');
  const [hearts, setHearts] = useState<number[]>([]);
  const [shown, setShown] = useState(0); // 目前播到第幾行
  const [busy, setBusy] = useState(false);
  const [autoCount, setAutoCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const pendingChats = useRef<string[]>([]);
  const closing = useRef(false);

  const live = sessions.find(s => !s.end) || null;
  const room = sessions.find(s => s.id === roomId) || null;
  const isLiveRoom = !!room && !room.end;

  const patch = useCallback((id: string, fn: (s: LiveSession) => LiveSession) =>
    setSessions(p => p.map(s => (s.id === id ? fn(s) : s))), [setSessions]);

  // 拉下一段
  const fetchNext = useCallback(async (s: LiveSession, opts: { opening?: boolean; closing?: boolean; topic?: string } = {}) => {
    setBusy(true);
    setFailed(false);
    const myChats = pendingChats.current.splice(0);
    try {
      const seg = await generateLiveSegment(s, makeCtx(), { ...opts, myChats });
      patch(s.id, x => ({
        ...x,
        viewers: seg.viewers,
        peak: Math.max(x.peak, seg.viewers),
        lines: [...x.lines, ...seg.lines],
        ...(opts.closing ? { end: Date.now() } : {}),
      }));
      setAutoCount(c => (myChats.length ? 0 : c + 1));
    } catch (e) {
      pendingChats.current.unshift(...myChats);
      setFailed(true); // 出錯就停，不自動重試
      toast(e instanceof SimError ? e.message : '直播訊號不穩');
      if (opts.closing) patch(s.id, x => ({ ...x, end: Date.now() }));
    } finally {
      setBusy(false);
    }
  }, [makeCtx, patch, toast]);

  // 一行一行播出來，播完自動接下一段
  useEffect(() => {
    if (!room) return;
    const total = room.lines.length;
    if (room.end) { setShown(total); return; }
    if (shown < total) {
      const next = room.lines[shown];
      const wait = next.kind === 'chat' ? 700 + Math.random() * 900 : next.kind === 'act' ? 1400 : 1800 + Math.min(next.text.length * 60, 2600);
      const t = setTimeout(() => setShown(n => n + 1), next.mine ? 0 : wait);
      return () => clearTimeout(t);
    }
    if (!busy && !failed && !closing.current && (autoCount < MAX_AUTO || pendingChats.current.length)) fetchNext(room);
  }, [room, shown, busy, failed, autoCount, fetchNext]);

  const enterRoom = (s: LiveSession) => {
    setRoomId(s.id);
    // 重新進入：直接跳到最新，只重播最後幾行
    setShown(s.end ? s.lines.length : Math.max(0, s.lines.length - 4));
    setAutoCount(0);
    setFailed(false);
    closing.current = false;
  };

  const startLive = () => {
    if (!pick.length) { toast('選至少一位成員'); return; }
    const s: LiveSession = {
      id: Date.now().toString(36), hosts: pick, title: title.trim() || `${pick.join(' & ')} 的直播`,
      start: Date.now(), viewers: 0, peak: 0, hearts: 0,
      lines: [{ id: 'sys0', kind: 'sys', who: '', text: '直播已開始' }],
    };
    setSessions(p => [...p, s]);
    setStartOpen(false);
    setRoomId(s.id);
    setShown(0);
    setAutoCount(0);
    closing.current = false;
    fetchNext(s, { opening: true, topic: topic.trim() });
    setPick([]); setTopic(''); setTitle('');
  };

  const send = () => {
    const t = chat.trim();
    if (!t || !room || room.end) return;
    const line: LiveLine = { id: `me-${Date.now()}`, kind: 'chat', who: '我', text: t, mine: true };
    // 插在目前播放位置，馬上看得到
    patch(room.id, x => ({ ...x, lines: [...x.lines.slice(0, shown), line, ...x.lines.slice(shown)] }));
    setShown(n => n + 1);
    pendingChats.current.push(t);
    setAutoCount(0);
    setChat('');
  };

  const tapHeart = () => {
    if (!room) return;
    const id = Date.now() + Math.random();
    setHearts(h => [...h.slice(-14), id]);
    setTimeout(() => setHearts(h => h.filter(x => x !== id)), 1600);
    patch(room.id, x => ({ ...x, hearts: x.hearts + 1 }));
  };

  const endLive = () => {
    if (!room || room.end) return;
    if (!window.confirm('讓她們下播嗎？')) return;
    closing.current = true;
    patch(room.id, x => ({ ...x, lines: x.lines.slice(0, shown) })); // 沒播的丟掉，直接收尾
    fetchNext({ ...room, lines: room.lines.slice(0, shown) }, { closing: true });
  };

  // ===== 直播間 =====
  if (room) {
    const visible = room.lines.slice(0, shown);
    const lastSay = [...visible].reverse().find(l => l.kind === 'say' || l.kind === 'act');
    const chats = visible.filter(l => l.kind === 'chat' || l.kind === 'sys').slice(-9);
    return (
      <div className="lv-room">
        <div className="lv-bg">
          {room.hosts.map((h, i) => (
            <div key={h} className="lv-host" style={{ background: grad(h), animationDelay: `${i * 0.4}s` }}>{h.slice(0, 1)}</div>
          ))}
        </div>

        <div className="lv-top">
          <div className="lv-who">
            <div className="lv-avs">{room.hosts.map(h => <i key={h} style={{ background: grad(h) }}>{h.slice(0, 1)}</i>)}</div>
            <div className="lv-tt"><b>{room.title}</b><small>{room.hosts.join(' · ')}</small></div>
          </div>
          <button className="lv-x" onClick={() => setRoomId(null)} aria-label="離開直播間"><ChevronDown size={20} /></button>
        </div>
        <div className="lv-badges">
          {room.end ? <span className="lv-badge end">已結束</span> : <span className="lv-badge">LIVE</span>}
          <span className="lv-badge dim"><Eye size={12} /> {fmt(room.viewers)}</span>
          <span className="lv-badge dim"><Heart size={12} /> {fmt(room.hearts)}</span>
          {isLiveRoom && <button className="lv-badge dim btn-end" onClick={endLive}><Square size={10} /> 讓她下播</button>}
        </div>

        {lastSay && (
          <div className={`lv-say ${lastSay.kind}`} key={lastSay.id}>
            {lastSay.kind === 'say' && <b>{lastSay.who}</b>}
            <span>{lastSay.kind === 'act' ? `${lastSay.who}${lastSay.text}` : lastSay.text}</span>
          </div>
        )}

        <div className="lv-chat">
          {chats.map(l => (
            <div key={l.id} className={`lv-c ${l.mine ? 'me' : ''} ${l.kind === 'sys' ? 'sys' : ''}`}>
              {l.kind !== 'sys' && <b>{l.who}</b>}{l.text}
            </div>
          ))}
          {busy && shown >= room.lines.length && <div className="lv-c sys"><Loader2 size={12} className="spin" /> 訊號連線中…</div>}
        </div>

        <div className="lv-hearts">
          {hearts.map(h => <span key={h} style={{ left: `${20 + (h * 1000) % 40}px` }}>♥</span>)}
        </div>

        {isLiveRoom ? (
          <div className="lv-foot">
            <div className="lv-in">
              <input value={chat} onChange={e => setChat(e.target.value)} placeholder="說點什麼…" enterKeyHint="send"
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) send(); }} />
              <button onClick={send} disabled={!chat.trim()} aria-label="送出"><ArrowUp size={18} strokeWidth={2.6} /></button>
            </div>
            <button className="lv-heart" onClick={tapHeart} aria-label="送愛心"><Heart size={22} fill="currentColor" /></button>
          </div>
        ) : (
          <div className="lv-foot"><div className="lv-ended">直播已結束 · {dur(room.start, room.end)} · 最高 {fmt(room.peak)} 人觀看</div></div>
        )}
        {isLiveRoom && (autoCount >= MAX_AUTO || failed) && !busy && shown >= room.lines.length && (
          <button className="lv-cont" onClick={() => { setAutoCount(0); setFailed(false); }}>{failed ? '重新連線' : '繼續看'}</button>
        )}
      </div>
    );
  }

  // ===== 直播大廳 =====
  const past = sessions.filter(s => s.end).reverse();
  return (
    <div className="feed" key="live-lobby">
      <div className="feed-in">
        {live ? (
          <button className="lv-card" onClick={() => enterRoom(live)}>
            <div className="lv-card-bg" style={{ background: grad(live.hosts[0]) }} />
            <span className="lv-badge">LIVE</span>
            <div className="lv-card-b">
              <div className="lv-avs">{live.hosts.map(h => <i key={h} style={{ background: grad(h) }}>{h.slice(0, 1)}</i>)}</div>
              <b>{live.title}</b>
              <small><Eye size={12} /> {fmt(live.viewers)} 人正在看 · {dur(live.start)}</small>
            </div>
          </button>
        ) : (
          <div className="empty">
            <div className="empty-ic"><Radio size={30} /></div>
            <b>現在沒有人在直播</b>
          </div>
        )}

        {!live && (
          <button className="btn soft" onClick={() => setStartOpen(true)}><Plus size={18} /> 神視：讓成員開播</button>
        )}

        {!!past.length && (
          <>
            <div className="lv-sec">過去的直播</div>
            {past.map(s => (
              <button className="rel" key={s.id} onClick={() => enterRoom(s)}>
                <div className="rel-pair">{s.hosts.map(h => <div key={h} className="av xs" style={{ background: grad(h) }}>{h.slice(0, 1)}</div>)}</div>
                <div className="rel-b">
                  <b>{s.title}</b>
                  <small>{new Date(s.start).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })} · {dur(s.start, s.end)} · 最高 {fmt(s.peak)} 人</small>
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {startOpen && (
        <>
          <div className="scrim" onClick={() => setStartOpen(false)} />
          <div className="sheet">
            <div className="grab" />
            <h3>讓誰開播？ <button className="ibtn" onClick={() => setStartOpen(false)} aria-label="關閉"><X size={20} /></button></h3>
            <p className="sub">可以選好幾個人一起開。</p>
            <div className="field">
              <div className="dm-pick" style={{ flexWrap: 'wrap' }}>
                {members.map(n => (
                  <button key={n} className={pick.includes(n) ? 'on' : ''} onClick={() => setPick(p => p.includes(n) ? p.filter(x => x !== n) : [...p, n])}>
                    <span className="av xs" style={{ background: grad(n) }}>{n.slice(0, 1)}</span>{n}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>直播標題（可不填）</label>
              <div className="inp"><input value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：睡不著來聊天" /></div>
            </div>
            <div className="field">
              <label>她們要做什麼（可不填）</label>
              <textarea className="ta" value={topic} onChange={e => setTopic(e.target.value)} placeholder="例如：練習完在宿舍吃宵夜、偷偷劇透新歌…" />
            </div>
            <button className="btn" style={{ width: '100%' }} onClick={startLive}><Radio size={18} /> 開播</button>
          </div>
        </>
      )}
    </div>
  );
}
