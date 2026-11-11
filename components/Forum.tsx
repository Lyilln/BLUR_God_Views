import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowUp, Loader2, PenLine, RefreshCw, Heart, MessageSquare, X, CornerDownRight } from 'lucide-react';
import { SimulationEvent, ForumReply } from '../types';
import { generateForumPosts, generateForumReplies, Ctx, SimError } from '../services/gemini';

type Props = {
  board: string;
  posts: SimulationEvent[];
  setPosts: (fn: (prev: SimulationEvent[]) => SimulationEvent[]) => void;
  makeCtx: () => Ctx;
  toast: (text: string) => void;
  listBusy: boolean;
  setListBusy: (on: boolean) => void;
};

const fmt = (n?: number) => (n || 0).toLocaleString('en-US');

// 內文裡的 [截圖] [動圖] 描述做成圖片佔位
function Body({ text }: { text?: string }) {
  const parts = (text || '').split(/(\[(?:截圖|動圖|照片|圖|影片)[^\]]*\][^\n]*)/g);
  return (
    <div className="fq-body">
      {parts.map((p, i) =>
        /^\[(截圖|動圖|照片|圖|影片)/.test(p)
          ? <div className="fq-img" key={i}>{p.replace(/^\[([^\]]*)\]\s*/, '$1 · ').replace(/ · $/, '')}</div>
          : <span key={i}>{p}</span>
      )}
    </div>
  );
}

export default function Forum({ board, posts, setPosts, makeCtx, toast, listBusy, setListBusy }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyBusy, setReplyBusy] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [writeOpen, setWriteOpen] = useState(false);
  const [draft, setDraft] = useState({ title: '', text: '' });
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setOpenId(null); }, [board]);

  const list = [...posts].filter(p => p.eventType === 'forum_post').reverse();
  const open = posts.find(p => p.eventId === openId) || null;

  const fail = (e: unknown) => {
    console.error(e);
    toast(e instanceof SimError ? e.message : '生成失敗，再試一次');
  };

  const refresh = async () => {
    if (listBusy) return;
    setListBusy(true);
    try {
      const fresh = await generateForumPosts(board, makeCtx(), posts);
      setPosts(p => [...p, ...fresh]);
    } catch (e) { fail(e); } finally { setListBusy(false); }
  };

  const publish = async () => {
    const title = draft.title.trim(), text = draft.text.trim();
    if (!title || !text) { toast('標題和內文都要寫'); return; }
    setWriteOpen(false);
    setListBusy(true);
    try {
      const [mine] = await generateForumPosts(board, makeCtx(), posts, { title, text });
      setPosts(p => [...p, mine]);
      setDraft({ title: '', text: '' });
      setOpenId(mine.eventId);
    } catch (e) { setWriteOpen(true); fail(e); } finally { setListBusy(false); }
  };

  const patchPost = (id: string, fn: (c: SimulationEvent['content']) => SimulationEvent['content']) =>
    setPosts(p => p.map(x => (x.eventId === id ? { ...x, content: fn(x.content) } : x)));

  const moreReplies = async (post: SimulationEvent, mine?: string) => {
    if (replyBusy) return;
    setReplyBusy(post.eventId);
    let target = post;
    if (mine) {
      const my: ForumReply = { id: `me-${Date.now()}`, author: '我', text: mine, type: 'neutral', mine: true };
      target = { ...post, content: { ...post.content, replies: [...(post.content.replies || []), my] } };
      patchPost(post.eventId, () => target.content);
      setComment('');
    }
    try {
      const add = await generateForumReplies(board, makeCtx(), target, mine);
      patchPost(post.eventId, c => ({ ...c, replies: [...(c.replies || []), ...add] }));
    } catch (e) { fail(e); } finally { setReplyBusy(null); }
  };

  const openPost = (p: SimulationEvent) => {
    setOpenId(p.eventId);
    if (!p.content.mine) patchPost(p.eventId, c => ({ ...c, views: (c.views || 0) + 1 }));
    if ((p.content.replies || []).length < 3) moreReplies(p);
  };

  useEffect(() => {
    const el = detailRef.current;
    if (el && replyBusy) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }, [replyBusy, open?.content.replies?.length]);

  // ===== 文章內頁 =====
  if (open) {
    const c = open.content;
    const replies = c.replies || [];
    return (
      <>
        <div className="feed fq" ref={detailRef} key={`post-${open.eventId}`}>
          <div className="fq-wrap">
            <button className="fq-back" onClick={() => setOpenId(null)}><ArrowLeft size={16} /> {board}</button>
            <article className="fq-post">
              <h2>{c.title}</h2>
              <div className="fq-meta">
                <span className={c.mine ? 'me' : ''}>{c.speaker || '匿名的BLUR粉'}</span>
                <span>{open.ts}</span><span>瀏覽 {fmt(c.views)}</span>
              </div>
              <Body text={c.text} />
              <div className="fq-acts">
                <button className={`fq-like ${c.liked ? 'on' : ''}`}
                  onClick={() => patchPost(open.eventId, x => ({ ...x, liked: !x.liked, likes: (x.likes || 0) + (x.liked ? -1 : 1) }))}>
                  <Heart size={16} fill={c.liked ? 'currentColor' : 'none'} /> 推 {fmt(c.likes)}
                </button>
              </div>
            </article>

            <div className="fq-ch">留言 <b>{replies.length}</b></div>
            <div className="fq-cmts">
              {replies.map((r, i) => (
                <div className={`fq-cmt ${r.mine ? 'me' : ''} ${r.to ? 'sub' : ''}`} key={r.id || i}>
                  <div className="fq-ct">
                    <em>{i + 1}</em>
                    <b>{r.mine ? '我' : r.author}</b>
                    {r.type === 'hater' && <span className="tag hater">黑</span>}
                    {r.type === 'shipper' && <span className="tag shipper">CP</span>}
                    {r.type === 'mom_fan' && <span className="tag mom_fan">媽粉</span>}
                    <button className="fq-re" onClick={() => setComment(`@${i + 1}樓 `)}>回覆</button>
                  </div>
                  {!!r.to && <div className="fq-to"><CornerDownRight size={12} />回覆 {r.to}樓</div>}
                  <p>{r.text}</p>
                </div>
              ))}
              {replyBusy === open.eventId && <div className="fq-loading"><Loader2 size={16} className="spin" /> 有人正在打字…</div>}
              {replyBusy !== open.eventId && (
                <button className="fq-more" onClick={() => moreReplies(open)}><RefreshCw size={14} /> 看更多留言</button>
              )}
            </div>
          </div>
        </div>
        <div className="composer">
          <div className="c-row glass">
            <input
              value={comment} onChange={e => setComment(e.target.value)} placeholder="留言…" enterKeyHint="send"
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && comment.trim()) moreReplies(open, comment.trim()); }}
            />
            <button className="send" disabled={!!replyBusy || !comment.trim()} onClick={() => moreReplies(open, comment.trim())} aria-label="送出留言">
              {replyBusy ? <Loader2 size={20} className="spin" /> : <ArrowUp size={20} strokeWidth={2.6} />}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ===== 文章列表 =====
  return (
    <>
      <div className="feed fq" key={`list-${board}`}>
        <div className="fq-wrap">
          <div className="fq-bar">
            <span>{board} · {list.length} 篇</span>
            <div>
              <button onClick={refresh} disabled={listBusy}>
                {listBusy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} 新文章
              </button>
              <button className="pri" onClick={() => setWriteOpen(true)}><PenLine size={15} /> 發文</button>
            </div>
          </div>

          <div className="fq-list">
            {listBusy && <div className="fq-loading row"><Loader2 size={16} className="spin" /> 正在刷新…</div>}
            {!list.length && !listBusy && (
              <div className="fq-empty">
                <p>這個板還沒有文章</p>
                <button className="btn" onClick={refresh}><RefreshCw size={16} /> 載入文章</button>
              </div>
            )}
            {list.map(p => {
              const c = p.content;
              const n = (c.replies || []).length;
              const hot = (c.views || 0) > 2500 || n >= 12;
              return (
                <button className="fq-row" key={p.eventId} onClick={() => openPost(p)}>
                  <div className="fq-t">
                    {hot && <span className="fq-hot">HOT</span>}
                    {c.mine && <span className="fq-mine">我</span>}
                    <span className="fq-title">{c.title}</span>
                    {n > 0 && <span className="fq-n">[{n}]</span>}
                  </div>
                  <div className="fq-meta">
                    <span>{c.mine ? '我' : (c.speaker || '匿名的BLUR粉')}</span>
                    <span>{p.ts}</span>
                    <span>瀏覽 {fmt(c.views)}</span>
                    {!!c.likes && <span>推 {fmt(c.likes)}</span>}
                    <span className="fq-ci"><MessageSquare size={11} />{n}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {writeOpen && (
        <>
          <div className="scrim" onClick={() => setWriteOpen(false)} />
          <div className="sheet">
            <div className="grab" />
            <h3>在「{board}」發文 <button className="ibtn" onClick={() => setWriteOpen(false)} aria-label="關閉"><X size={20} /></button></h3>
            <p className="sub">發出去後，其他網友會開始留言。可以用 [截圖] 描述圖片。</p>
            <div className="field">
              <label>標題</label>
              <div className="inp"><input value={draft.title} onChange={e => { const v = e.target.value; setDraft(d => ({ ...d, title: v })); }} placeholder="【】(+) 都可以用" /></div>
            </div>
            <div className="field">
              <label>內文</label>
              <textarea className="ta" style={{ minHeight: 140 }} value={draft.text} onChange={e => { const v = e.target.value; setDraft(d => ({ ...d, text: v })); }} />
            </div>
            <button className="btn" style={{ width: '100%' }} onClick={publish}>發佈</button>
          </div>
        </>
      )}
    </>
  );
}
