import {
  SHORTS_SCRIPT_SCHEMA,
  buildRecipePrompt,
  buildTitlePrompt
} from "./openai-shorts.mjs";

const SYSTEM_PROMPT = "너는 초간단 요리 숏츠 전문 작가다. 정확한 1인분 재료와 안전한 조리법을 사용하고 항상 한국어 JSON으로 작성한다.";

export function generateOllamaScriptFromTitle({ baseUrl, model, title }) {
  return requestOllamaScript({ baseUrl, model, prompt: buildTitlePrompt(title) });
}

export function generateOllamaScriptFromRecipe({ baseUrl, model, recipe }) {
  return requestOllamaScript({ baseUrl, model, prompt: buildRecipePrompt(recipe) });
}

async function requestOllamaScript({ baseUrl, model, prompt }) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: SHORTS_SCRIPT_SCHEMA,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      options: { temperature: 0 }
    }),
    signal: AbortSignal.timeout(120_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw serviceError(data?.error || `Ollama 호출에 실패했습니다. (${response.status})`);
  try {
    const script = JSON.parse(data?.message?.content || "");
    validateScript(script);
    return { ...script, source: "ollama" };
  } catch {
    throw serviceError("Ollama가 올바른 대본 JSON을 반환하지 않았습니다.");
  }
}

function normalizeBaseUrl(value) {
  return String(value || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
}

function validateScript(script) {
  const ranges = ["0~3초", "3~8초", "8~30초", "30~40초"];
  if (!script || script.duration !== 40 || !Array.isArray(script.scenes) || script.scenes.length !== 4) throw new Error("invalid script");
  if (!script.scenes.every((scene, index) => scene.range === ranges[index] && scene.label && scene.narration && scene.visual)) throw new Error("invalid scenes");
  if (!script.title || !script.thumbnail || !Array.isArray(script.hashtags)) throw new Error("invalid metadata");
}

function serviceError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}
