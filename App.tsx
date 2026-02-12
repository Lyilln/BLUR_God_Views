
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Users, MessageSquare, Play, Home, Music, 
  Tv, Building2, Mic, Globe, X, Menu, Sun, Moon, 
  Sparkles, Zap, Heart, RefreshCw, Key, Loader2, Ghost, ArrowLeftRight, Pause,
  Filter, Send, RotateCcw, UserPlus, Info, ChevronDown, Layout, Edit3, Save, Trash2,
  Settings as SettingsIcon, Link2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SceneType, SimulationEvent, Settings, SimulationBlock, RelationshipLink, ForumReply } from './types';
import { PERSONA_DATA, INITIAL_RELATIONSHIPS, MUSIC_SHOWS, VARIETY_SHOWS, FORUM_BOARDS } from './constants';
import { generateSimulation } from './services/gemini';

const SCENE_BG: Record<SceneType, string> = {
  group_chat: 'bg-slate-50 dark:bg-slate-950',
  dm: 'bg-white dark:bg-slate-950',
  practice_room: 'bg-zinc-100 dark:bg-zinc-900',
  dorm: 'bg-orange-50/10 dark:bg-neutral-950',
  stage: 'bg-black',
  variety: 'bg-emerald-50/10 dark:bg-slate-950',
  company: 'bg-slate-50 dark:bg-slate-950',
  studio: 'bg-indigo-50/10 dark:bg-slate-950',
  forum: 'bg-gray-100 dark:bg-gray-950',
  relationship_map: 'bg-slate-950'
};

const SCENE_LABELS: Record<SceneType, string> = {
  group_chat: '團體聊天室', dm: '私密監控', practice_room: '練習室',
  dorm: '宿舍', stage: '打歌舞台', variety: '綜藝節目', company: '經紀公司',
  studio: '錄音室', forum: '粉絲論壇', relationship_map: '關係圖譜'
};

const CHARACTER_ANIMATIONS: Record<string, any> = {
  Chloe: { rotate: [0, 5, -5, 0], transition: { repeat: Infinity, duration: 1.5 } },
  RAHI: { y: [0, -10, 0], transition: { repeat: Infinity, duration: 0.8 } },
  Nanae: { opacity: [1, 0.7, 1], transition: { repeat: Infinity, duration: 3 } },
  Yeongri: { scale: [1, 1.02, 1], transition: { repeat: Infinity, duration: 2 } },
  Sera: { x: [0, 2, -2, 0], transition: { repeat: Infinity, duration: 4 } },
};

// 用於計算關係圖座標的 Helper
const getInitialNodePos = (index: number, total: number, radius: number) => {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
};

export default function App() {
  const [activeScene, setActiveScene] = useState<SceneType>('group_chat');
  const [subScene, setSubScene] = useState<string>('');
  const [selectedMembers, setSelectedMembers] = useState<string[]>(['Chloe', 'RAHI']);
  const [sceneHistory, setSceneHistory] = useState<Record<string, SimulationEvent[]>>({});
  const [directorCommand, setDirectorCommand] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [relationships, setRelationships] = useState<RelationshipLink[]>(INITIAL_RELATIONSHIPS);
  const [isEditingRel, setIsEditingRel] = useState(false);
  const [filterType, setFilterType] = useState<string | null>(null);

  // 關係圖節點位置狀態 (用於連線)
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const initialPos: Record<string, { x: number; y: number }> = {};
    Object.keys(PERSONA_DATA).forEach((name, i) => {
      initialPos[name] = getInitialNodePos(i, 5, 120);
    });
    return initialPos;
  });
  
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
  const saved = localStorage.getItem('blur_v8_history');
  const savedRel = localStorage.getItem('blur_v8_rel');
  if (saved) setSceneHistory(JSON.parse(saved));
  if (savedRel) setRelationships(JSON.parse(savedRel));
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) setDarkMode(true);

  // ✅ 讓右上角鑰匙「真的會跳輸入框」
  (window as any).openSelectKey = () => {
    const current = localStorage.getItem('GEMINI_API_KEY') || '';
    const next = window.prompt('貼上你的 Gemini API Key', current);
    if (!next) return null;
    localStorage.setItem('GEMINI_API_KEY', next.trim());
    alert('已儲存 ✅');
    return next.trim();
  };
}, []);

  useEffect(() => {
    localStorage.setItem('blur_v8_history', JSON.stringify(sceneHistory));
    localStorage.setItem('blur_v8_rel', JSON.stringify(relationships));
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [sceneHistory, relationships]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const runSimulation = useCallback(async (customCmd?: string) => {
    if (isGenerating) return;
    setIsGenerating(true);
    const key = activeScene === 'dm' ? `dm:${[...selectedMembers].sort().join('-')}` : (subScene || activeScene);
    
    try {
      const block = await generateSimulation(
        activeScene, 
        { speed: 'medium', autonomous: true } as Settings, 
        customCmd || directorCommand,
        { subScene, history: sceneHistory[key], relationships }
      );
      if (block.events) {
        setSceneHistory(p => ({ ...p, [key]: [...(p[key] || []), ...block.events] }));
      }
    } catch (e) { console.error(e); } finally { 
      setIsGenerating(false); 
      setDirectorCommand(''); 
    }
  }, [activeScene, subScene, selectedMembers, directorCommand, isGenerating, sceneHistory, relationships]);

  const currentKey = activeScene === 'dm' ? `dm:${[...selectedMembers].sort().join('-')}` : (subScene || activeScene);
  const currentEvents = useMemo(() => {
    const events = sceneHistory[currentKey] || [];
    if (!filterType) return events;
    return events.filter(e => e.eventType === filterType);
  }, [sceneHistory, currentKey, filterType]);

  const updateRelationship = (index: number, field: keyof RelationshipLink, value: any) => {
    const newRels = [...relationships];
    newRels[index] = { ...newRels[index], [field]: value };
    setRelationships(newRels);
  };

  const RelationshipMap = () => {
    const containerRef = useRef<HTMLDivElement>(null);

    return (
      <div ref={containerRef} className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle, #4f46e5 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
        </div>

        {/* SVG 連接線層 */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="25" refY="3.5" orientation="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
            </marker>
          </defs>
          {relationships.map((rel, i) => {
            const start = nodePositions[rel.from];
            const end = nodePositions[rel.to];
            if (!start || !end) return null;
            
            // 將相對座標轉換為畫布中心座標
            const centerX = (containerRef.current?.clientWidth || 0) / 2;
            const centerY = (containerRef.current?.clientHeight || 0) / 2;

            return (
              <motion.line 
                key={`${rel.from}-${rel.to}-${i}`} 
                x1={centerX + start.x} y1={centerY + start.y} 
                x2={centerX + end.x} y2={centerY + end.y} 
                stroke="#6366f1" 
                strokeWidth={Math.max(1, rel.level / 20)}
                strokeOpacity={0.4}
                className="relationship-line"
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </svg>

        {/* 成員節點 */}
        <div className="relative w-full h-full">
          {Object.keys(PERSONA_DATA).map((name) => (
            <motion.div 
              key={name}
              drag
              dragMomentum={false}
              onDrag={(_, info) => {
                setNodePositions(prev => ({
                  ...prev,
                  [name]: { 
                    x: prev[name].x + info.delta.x, 
                    y: prev[name].y + info.delta.y 
                  }
                }));
              }}
              initial={{ x: nodePositions[name].x, y: nodePositions[name].y }}
              animate={{ x: nodePositions[name].x, y: nodePositions[name].y }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3 cursor-grab active:cursor-grabbing z-20 group"
            >
              <div className="relative">
                <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-full bg-indigo-600/20 border-2 border-indigo-500/50 backdrop-blur-md flex items-center justify-center text-white font-black text-xl sm:text-3xl shadow-[0_0_30px_rgba(79,70,229,0.2)] group-hover:scale-110 transition-transform overflow-hidden">
                   {name[0]}
                </div>
                <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center border-2 border-slate-900 shadow-lg">
                  <Link2 size={12} className="text-white" />
                </div>
              </div>
              <div className="bg-slate-900/90 border border-indigo-500/30 px-3 py-1 rounded-full text-[11px] text-indigo-100 font-black shadow-xl backdrop-blur-sm whitespace-nowrap">
                {name}
              </div>
            </motion.div>
          ))}
        </div>

        {/* 關係詳情浮窗 */}
        <div className="absolute top-24 left-6 max-w-[200px] pointer-events-none hidden sm:block">
          <div className="glass p-4 rounded-2xl border border-indigo-500/20">
            <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">現有連結</h4>
            <div className="space-y-2">
              {relationships.slice(0, 5).map((rel, i) => (
                <div key={i} className="text-[10px] flex flex-col">
                  <span className="font-bold text-white opacity-80">{rel.from} ↔ {rel.to}</span>
                  <span className="text-indigo-400 font-mono">{rel.type} ({rel.level}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderEvent = (ev: SimulationEvent) => {
    const isStage = activeScene === 'stage';
    const isForum = activeScene === 'forum';
    const isVariety = activeScene === 'variety';
    const isChat = activeScene === 'group_chat' || activeScene === 'dm';

    if (isForum && ev.eventType === 'forum_post') {
      return (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-white dark:bg-gray-800 p-5 rounded-2xl border shadow-md space-y-4">
          <div className="flex items-center justify-between">
            <span className="bg-indigo-600 text-white px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">{ev.content.board || '一般討論'}</span>
            <span className="text-[9px] font-mono text-gray-400">{ev.ts}</span>
          </div>
          <h3 className="font-black text-base text-slate-800 dark:text-white leading-tight">{ev.content.title}</h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{ev.content.text}</p>
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
            {ev.content.replies?.map((reply, rid) => (
              <div key={reply.id || rid} className="text-[10px] flex flex-col gap-1 bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg">
                <div className="flex justify-between opacity-60">
                  <span className="font-black text-indigo-500">{reply.author}</span>
                  <span className="text-[8px] uppercase tracking-tighter">{reply.type}</span>
                </div>
                <span className="text-slate-700 dark:text-slate-200">{reply.text}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setDirectorCommand(`回應論壇貼文: ${ev.content.title}`)} className="text-[10px] font-black text-indigo-500 hover:underline">我也要回覆...</button>
        </motion.div>
      );
    }

    return (
      <div className={`group flex flex-col ${isStage ? 'border-l-4 border-indigo-500 pl-6 py-4 my-2' : ''}`}>
        {ev.content.speaker && (
          <div className="flex items-center gap-2 mb-1.5">
            <motion.div animate={CHARACTER_ANIMATIONS[ev.content.speaker] || {}} className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
            <span className="text-[11px] font-black text-indigo-500 uppercase tracking-widest">{ev.content.speaker}</span>
            {ev.content.stage_phase && <span className="text-[9px] bg-zinc-800 text-zinc-400 px-2 rounded font-bold">{ev.content.stage_phase}</span>}
          </div>
        )}
        
        <div className={`p-4 rounded-2xl border shadow-sm text-xs leading-relaxed transition-all ${isStage ? 'bg-zinc-900/80 text-zinc-100 border-zinc-800' : 'bg-white dark:bg-gray-800'}`}>
          {ev.content.text}
          {ev.content.detail && (
            <div className={`mt-3 p-2 rounded-lg text-[10px] font-bold font-mono ${isVariety ? 'bg-emerald-500/10 text-emerald-500 italic' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'}`}>
              {ev.content.detail}
            </div>
          )}
          {isStage && ev.content.stage_phase === '舞台表演' && (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-zinc-800">
               {ev.content.outfit && <div className="text-[10px]"><span className="text-indigo-400 font-black block uppercase mb-1">Styling</span> {ev.content.outfit}</div>}
               {ev.content.camera && <div className="text-[10px]"><span className="text-indigo-400 font-black block uppercase mb-1">Direction</span> {ev.content.camera}</div>}
               <button 
                  onClick={() => runSimulation(`REPLAY STAGE MOMENT: ${ev.content.text}`)}
                  className="mt-2 flex items-center gap-2 text-indigo-400 hover:text-white transition-colors text-[9px] font-black"
                >
                  <RotateCcw size={12} /> REPLAY PERFORMANCE
               </button>
            </div>
          )}
        </div>

        {ev.content.action && !isChat && (
          <p className="mt-1.5 text-[10px] text-gray-500 italic px-2 font-medium opacity-80">* {ev.content.action}</p>
        )}
      </div>
    );
  };

  return (
    <div className={`flex h-full w-full ${SCENE_BG[activeScene]} overflow-hidden`}>
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside 
            initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }}
            className="fixed inset-y-0 left-0 z-[60] w-64 glass border-r shadow-2xl lg:relative lg:translate-x-0"
          >
            <div className="p-6 h-full flex flex-col">
              <div className="flex items-center justify-between mb-10">
                <h1 className="text-xl font-black text-indigo-600 dark:text-indigo-400 flex items-center gap-2 tracking-tighter"><Ghost size={24} /> BLUR GOD VIEW</h1>
                <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1"><X /></button>
              </div>
              <nav className="flex-1 space-y-1.5 overflow-y-auto no-scrollbar">
                {Object.entries(SCENE_LABELS).map(([id, label]) => (
                  <motion.button 
                    whileHover={{ x: 5 }}
                    key={id} 
                    onClick={() => { setActiveScene(id as SceneType); setSubScene(''); setIsSidebarOpen(false); }} 
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-[11px] font-black transition-all ${activeScene === id ? 'bg-indigo-600 text-white shadow-[0_10px_20px_rgba(79,70,229,0.3)]' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                  >
                    {label}
                  </motion.button>
                ))}
              </nav>
              <div className="mt-4 pt-6 border-t flex flex-col gap-2">
                <button onClick={() => setDarkMode(!darkMode)} className="flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-widest">
                   {darkMode ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} className="text-indigo-600" />}
                   Mode: {darkMode ? 'Dark' : 'Light'}
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="glass px-6 py-4 flex flex-col border-b z-40 bg-white/70 dark:bg-slate-900/70">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              {!isSidebarOpen && <button onClick={() => setIsSidebarOpen(true)} className="p-2 rounded-xl border bg-white dark:bg-slate-800 lg:hidden shadow-sm"><Menu size={20} /></button>}
              <div>
                <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{SCENE_LABELS[activeScene]}</h2>
                {subScene && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm font-black text-indigo-600 block">{subScene}</motion.span>}
              </div>
            </div>
            <div className="flex gap-2">
              {activeScene === 'relationship_map' && (
                <button 
                  onClick={() => setIsEditingRel(!isEditingRel)}
                  className={`p-2.5 rounded-xl border transition-all flex items-center gap-2 text-[10px] font-black ${isEditingRel ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800'}`}
                >
                  <Edit3 size={16} /> <span className="hidden sm:inline">EDIT MAP</span>
                </button>
              )}
              <button 
                onClick={() => setFilterType(filterType ? null : 'message')}
                className={`p-2.5 rounded-xl border transition-all ${filterType ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800'}`}
              >
                <Filter size={16} />
              </button>
              <button onClick={() => runSimulation()} disabled={isGenerating} className="p-2.5 border rounded-xl bg-white dark:bg-slate-800 text-indigo-600 hover:rotate-180 transition-transform duration-500 disabled:opacity-50 shadow-sm"><RefreshCw size={16} /></button>
              <button
  onClick={() => (window as any).openSelectKey?.()}
  className="p-2.5 rounded-xl border transition-all bg-white dark:bg-slate-800 text-indigo-600 shadow-sm"
  title="設定 API Key"
  aria-label="設定 API Key"
>
  <Key size={16} />
</button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {(activeScene === 'stage' || activeScene === 'variety' || activeScene === 'forum') && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                className="flex gap-2 overflow-x-auto no-scrollbar pb-1"
              >
                {(activeScene === 'stage' ? MUSIC_SHOWS : activeScene === 'variety' ? VARIETY_SHOWS : FORUM_BOARDS).map(show => (
                  <button 
                    key={show} 
                    onClick={() => setSubScene(show)} 
                    className={`px-4 py-1.5 rounded-full text-[10px] font-black whitespace-nowrap transition-all border shadow-sm ${subScene === show ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200'}`}
                  >
                    {show}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </header>

        <div className="flex-1 relative overflow-hidden">
          {activeScene === 'relationship_map' ? (
            <div className="w-full h-full relative">
              <RelationshipMap />
              <AnimatePresence>
                {isEditingRel && (
                  <motion.div 
                    initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                    className="absolute inset-y-0 right-0 w-full sm:w-80 glass border-l p-6 overflow-y-auto z-[55] bg-white/95 dark:bg-slate-900/95 shadow-2xl pb-40"
                  >
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-sm font-black flex items-center gap-2"><SettingsIcon size={18} /> 關係引擎參數</h3>
                      <button onClick={() => setIsEditingRel(false)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"><X size={20} /></button>
                    </div>
                    <div className="space-y-6">
                      {relationships.map((rel, i) => (
                        <div key={i} className="space-y-4 p-4 border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-800/50 shadow-sm">
                          <div className="flex justify-between items-center text-[11px] font-black text-indigo-500 uppercase">
                            <span>{rel.from} ↔ {rel.to}</span>
                            <button onClick={() => setRelationships(p => p.filter((_, idx) => idx !== i))} className="p-1 text-red-400 hover:bg-red-50 rounded"><Trash2 size={14} /></button>
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black opacity-40 uppercase">關係類型</label>
                            <input 
                              className="w-full text-xs bg-slate-50 dark:bg-slate-950 p-2 rounded-lg outline-none border border-slate-100 dark:border-slate-800" 
                              value={rel.type} 
                              onChange={(e) => updateRelationship(i, 'type', e.target.value)} 
                            />
                          </div>
                          <div className="space-y-1">
                             <div className="flex justify-between items-center">
                               <label className="text-[9px] font-black opacity-40 uppercase">親密度</label>
                               <span className="text-[10px] font-mono text-indigo-500 font-black">{rel.level}%</span>
                             </div>
                            <input 
                              type="range" className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600" value={rel.level} 
                              onChange={(e) => updateRelationship(i, 'level', parseInt(e.target.value))} 
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[9px] font-black opacity-40 uppercase">細部註記</label>
                            <textarea 
                              className="w-full text-[10px] bg-slate-50 dark:bg-slate-950 p-2 rounded-lg outline-none border border-slate-100 dark:border-slate-800 min-h-[60px]" 
                              value={rel.note} 
                              onChange={(e) => updateRelationship(i, 'note', e.target.value)}
                            />
                          </div>
                        </div>
                      ))}
                      <button 
                        onClick={() => setRelationships([...relationships, { from: 'Chloe', to: 'Nanae', type: '新關係', level: 50, note: '描述此關係...' }])}
                        className="w-full py-4 border-2 border-dashed border-indigo-200 dark:border-indigo-900 rounded-2xl text-[10px] font-black text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950 transition-all uppercase tracking-widest"
                      >
                        + ADD NEW CONNECTION
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <div ref={feedRef} className="h-full overflow-y-auto px-6 py-8 no-scrollbar scroll-smooth">
              <div className="max-w-3xl mx-auto space-y-8 pb-48">
                {currentEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-40 opacity-20 space-y-4">
                    <Sparkles size={64} className="animate-pulse" />
                    <p className="text-sm font-black tracking-widest uppercase">Initializing Observation Signal...</p>
                  </div>
                )}
                <AnimatePresence mode="popLayout">
                  {currentEvents.map((ev, idx) => (
                    <motion.div 
                      key={ev.eventId || idx} 
                      layout
                      initial={{ opacity: 0, y: 20, scale: 0.98 }} 
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ type: 'spring', damping: 20 }}
                    >
                      {renderEvent(ev)}
                    </motion.div>
                  ))}
                </AnimatePresence>
                {isGenerating && (
                  <div className="flex gap-2 items-center opacity-40 px-4">
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-2 h-2 rounded-full bg-indigo-500" />
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-2 h-2 rounded-full bg-indigo-500" />
                    <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-2 h-2 rounded-full bg-indigo-500" />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {activeScene !== 'relationship_map' && (
          <footer className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-3xl z-50">
            <div className="glass p-3 border rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.2)] bg-white/80 dark:bg-slate-900/80 flex flex-col gap-2">
              {activeScene === 'dm' && (
                <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 flex gap-2 overflow-x-auto no-scrollbar items-center">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-tighter whitespace-nowrap"><UserPlus size={12} className="inline mr-1" /> TARGET:</div>
                  {Object.keys(PERSONA_DATA).map(name => (
                    <button 
                      key={name} 
                      onClick={() => setSelectedMembers(p => p.includes(name) ? p.filter(n => n !== name) : p.length < 2 ? [...p, name] : [p[1], name])} 
                      className={`px-3 py-1 rounded-xl text-[10px] font-black border transition-all whitespace-nowrap ${selectedMembers.includes(name) ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white/50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
              
              <div className="flex gap-3 items-center">
                <input 
                  type="text" 
                  value={directorCommand} 
                  onChange={e => setDirectorCommand(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && runSimulation()} 
                  placeholder={activeScene === 'forum' ? "以匿名粉絲身份發表觀點..." : "下達神視干涉指令..."} 
                  className="flex-1 bg-transparent border-none px-4 py-3 text-sm outline-none font-medium placeholder:text-slate-400" 
                />
                <motion.button 
                  whileTap={{ scale: 0.9 }}
                  onClick={() => runSimulation()} 
                  disabled={isGenerating} 
                  className="bg-indigo-600 text-white p-4 rounded-[1.5rem] shadow-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                </motion.button>
              </div>
            </div>
          </footer>
        )}
      </main>
    </div>
  );
}
