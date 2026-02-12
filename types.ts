
export type SceneType = 'group_chat' | 'dm' | 'practice_room' | 'dorm' | 'stage' | 'variety' | 'company' | 'studio' | 'forum' | 'relationship_map';

export type EventType = 'message' | 'action' | 'stage_moment' | 'variety_beat' | 'scene_change' | 'system_note' | 'forum_post' | 'forum_reply';

export interface ForumReply {
  id: string;
  author: string;
  text: string;
  type: 'fan' | 'hater' | 'neutral' | 'shipper' | 'mom_fan';
}

export interface EventContent {
  speaker?: string;
  text?: string;
  action?: string;
  // 舞台專用
  outfit?: string;
  lighting?: string;
  camera?: string;
  choreography?: string;
  stage_phase?: '待機室' | '上台前' | '舞台表演' | '下台後';
  // 綜藝專用
  variety_persona?: string;
  detail?: string; // 用於「剪輯字幕」或「職場備註」
  mood?: 'happy' | 'tense' | 'emotional' | 'funny' | 'professional';
  // 論壇專用
  title?: string;
  replies?: ForumReply[];
  board?: string;
}

export interface SimulationEvent {
  eventId: string;
  ts: string;
  eventType: EventType;
  participants: string[];
  content: EventContent;
}

export interface SimulationBlock {
  sessionId: string;
  scene: {
    sceneId: string;
    sceneType: SceneType;
    locationLabel: string;
    subScene?: string;
  };
  events: SimulationEvent[];
}

export interface Settings {
  speed: 'slow' | 'medium' | 'fast';
  autonomous: boolean;
}

export interface RelationshipLink {
  from: string;
  to: string;
  type: string;
  level: number; // 0-100
  note: string;
}
