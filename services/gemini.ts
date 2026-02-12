
import { GoogleGenAI, Type } from "@google/genai";
import { SimulationBlock, Settings, SceneType } from "../types";
import { PERSONA_DATA, WORLD_VIEW } from "../constants";

export async function generateSimulation(
  scene: SceneType,
  settings: Settings,
  command: string,
  context?: { subScene?: string; history?: any[]; relationships?: any[] }
): Promise<SimulationBlock> {
  const storedKey =
  (typeof window !== "undefined" && window.localStorage)
    ? (localStorage.getItem("GEMINI_API_KEY") || "").trim()
    : "";

const apiKey = storedKey || ((process.env as any)?.API_KEY || "");

if (!apiKey) {
  throw new Error("NO_API_KEY");
}

const ai = new GoogleGenAI({ apiKey });
  
  const relContext = context?.relationships 
    ? context.relationships.map(r => `${r.from}-${r.to}: ${r.type}(${r.level}%): ${r.note}`).join('\n')
    : "Standard relationships.";

  const personaContext = Object.values(PERSONA_DATA)
    .map(p => `${p.name}: ${p.traits} Speech: ${p.speech}`)
    .join('\n');

  let sceneSpecificInstruction = "";
  
  if (scene === 'stage') {
    sceneSpecificInstruction = `
      SCENE: MUSIC SHOW [${context?.subScene || 'M Countdown'}].
      MANDATORY: Generate 4 distinct events in chronological order:
      1. [待機室]: Interaction inside, makeup check.
      2. [上台前]: Nerves, chant, final mic check.
      3. [舞台表演]: PERFORMANCE. Detail 'outfit', 'lighting', 'camera' (moves like Crane/Zoom), 'choreography', and 2 Killing Parts.
      4. [下台後]: Exhaustion, group hug, staff feedback.
      Do not include hosts' private lives. Use show-style MC dialogue.
    `;
  } else if (scene === 'variety') {
    sceneSpecificInstruction = `
      SCENE: VARIETY SHOW [${context?.subScene || 'Weekly Idol'}].
      Identify each member's variety persona (e.g., black hole, tsukkomi, energy saver).
      Include 3 killing parts. 
      Use 'detail' for "Editing Captions" like [字幕: 這是什麼靈魂畫作?]
    `;
  } else if (scene === 'forum') {
    sceneSpecificInstruction = `
      SCENE: FAN FORUM. Board: ${context?.subScene || '回歸討論'}.
      Create a thread with Title, Author (anonymous ID), Body.
      Include 3-12 replies with distinct personas: Rational, Shipper, Mom-fan, Hater, Passerby.
      Reflect current vibes or recent stage events.
    `;
  } else if (scene === 'company') {
    sceneSpecificInstruction = `
      SCENE: SM-style Company. Area: Hallway, Manager's desk, or Meeting room.
      Generic staff roles (A&R, Manager, Room chief).
      Show workplace hierarchy and pressure.
    `;
  } else if (scene === 'group_chat' || scene === 'dm') {
    sceneSpecificInstruction = `
      SCENE: MOBILE MESSAGING.
      STRICT RULE: Dialogue ONLY. DO NOT describe physical actions or inner thoughts. 
      Only pure text messages.
    `;
  }

  const systemInstruction = `
    You are the 'BLUR GOD VIEW' Engine. 
    Worldview: ${WORLD_VIEW.concept}.
    Profiles:\n${personaContext}\n
    Current Relationships:\n${relContext}\n
    
    Current Setting: ${scene}.
    ${sceneSpecificInstruction}
    
    AUTONOMOUS MODE: Progress the narrative naturally even if command is brief.
    Language: Traditional Chinese (Taiwan).
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: "Generate the next simulation block.",
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sessionId: { type: Type.STRING },
            scene: {
              type: Type.OBJECT,
              properties: {
                sceneId: { type: Type.STRING },
                sceneType: { type: Type.STRING },
                locationLabel: { type: Type.STRING },
                subScene: { type: Type.STRING }
              },
              required: ["sceneId", "sceneType", "locationLabel"],
            },
            events: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  eventId: { type: Type.STRING },
                  ts: { type: Type.STRING },
                  eventType: { type: Type.STRING },
                  participants: { type: Type.ARRAY, items: { type: Type.STRING } },
                  content: {
                    type: Type.OBJECT,
                    properties: {
                      speaker: { type: Type.STRING },
                      text: { type: Type.STRING },
                      action: { type: Type.STRING },
                      outfit: { type: Type.STRING },
                      lighting: { type: Type.STRING },
                      camera: { type: Type.STRING },
                      choreography: { type: Type.STRING },
                      stage_phase: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      title: { type: Type.STRING },
                      replies: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            id: { type: Type.STRING },
                            author: { type: Type.STRING },
                            text: { type: Type.STRING },
                            type: { type: Type.STRING }
                          }
                        }
                      }
                    },
                  },
                },
                required: ["eventId", "ts", "eventType", "participants", "content"],
              },
            },
          },
          required: ["sessionId", "scene", "events"],
        },
      },
    });

    return JSON.parse(response.text || "{}") as SimulationBlock;
  } catch (error: any) {
    if (error?.message?.includes("Requested entity was not found.")) {
      if (window.aistudio) await (window.aistudio as any).openSelectKey();
    }
    throw error;
  }
}
