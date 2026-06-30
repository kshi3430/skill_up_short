import { SHORTS_SCRIPT_SCHEMA, buildRecipePrompt, buildTitlePrompt } from "./openai-shorts.mjs";

export const GEMINI_MODEL = "gemini-2.5-flash-lite";

export async function generateGeminiScriptFromTitle({ apiKey, title, model = GEMINI_MODEL }) {
  return generateGeminiScript({ apiKey, model, prompt: buildTitlePrompt(title) });
}

export async function generateGeminiScriptFromRecipe({ apiKey, recipe, model = GEMINI_MODEL }) {
  return generateGeminiScript({ apiKey, model, prompt: buildRecipePrompt(recipe) });
}

export async function generateGeminiScript({ apiKey, prompt, model = GEMINI_MODEL }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let validationError;
  for (let generationAttempt = 0; generationAttempt < 2; generationAttempt += 1) {
    const safetyCorrection = generationAttempt === 0 ? "" : "\n\n이전 결과가 식품 안전 검사를 통과하지 못했다. 달걀은 프라이, 스크램블 또는 전자레인지 가열로 노른자까지 완전히 익혀라. 생달걀과 생노른자를 밥에 비비는 방법은 절대 쓰지 마라. 육류와 해산물도 속까지 완전히 익혀라.";
    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "너는 초간단 요리 숏츠 전문 작가다. 정확한 1인분 재료와 안전한 조리법을 사용하고 항상 한국어로 작성한다. 달걀은 프라이, 스크램블 또는 전자레인지 가열로 노른자까지 완전히 익힌다. 생달걀이나 생노른자를 밥에 비비는 조리법은 금지한다. 육류와 해산물도 속까지 완전히 익힌다. 전자레인지에는 밀폐 용기, 껍데기째 달걀, 금속을 사용하지 않는다." }]
        },
        contents: [{ role: "user", parts: [{ text: `${prompt}${safetyCorrection}` }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: SHORTS_SCRIPT_SCHEMA,
          maxOutputTokens: 1000,
          temperature: generationAttempt === 0 ? 0.6 : 0.2
        }
      })
    });
    const data = await response.json();
    if (!response.ok) throw providerError(data?.error?.message || "Gemini 대본 생성에 실패했습니다.");
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
    if (!text) throw providerError("Gemini가 대본을 반환하지 않았습니다.");
    try {
      const script = JSON.parse(text);
      validateScript(script);
      validateFoodSafety(script);
      return { ...script, source: "gemini" };
    } catch (error) {
      validationError = error;
    }
  }
  throw providerError(validationError?.message === "unsafe food instructions" ? "안전한 조리법을 생성하지 못했습니다. 다른 레시피명으로 다시 시도해주세요." : "Gemini가 올바른 대본 형식을 반환하지 않았습니다.");
}

function validateScript(script) {
  const ranges = ["0~3초", "3~8초", "8~30초", "30~40초"];
  if (!script?.title || script.duration !== 40 || !Array.isArray(script.scenes) || script.scenes.length !== 4) throw new Error("invalid script");
  if (!script.scenes.every((scene, index) => scene.range === ranges[index] && scene.narration && scene.visual)) throw new Error("invalid scenes");
  if (!Array.isArray(script.hashtags)) throw new Error("invalid hashtags");
}

function validateFoodSafety(script) {
  const text = script.scenes.map((scene) => `${scene.narration} ${scene.visual}`).join(" ");
  const mentionsEgg = /(계란|달걀|노른자)/u.test(text);
  const hasCookedEgg = /(완전히\s*익|노른자까지\s*익|프라이|후라이|스크램블|(달걀|계란).{0,20}(익|굽|가열)|전자레인지.{0,20}(익|가열))/u.test(text);
  const unsafeRawFood = /(생계란|날달걀|생노른자|노른자만\s*(톡|올|넣)|노른자.{0,12}(비비|비벼)|덜\s*익힌\s*(고기|육류|닭|돼지|해산물))/u.test(text);
  if (unsafeRawFood || (mentionsEgg && !hasCookedEgg)) throw new Error("unsafe food instructions");
}

async function fetchWithRetry(url, options, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`Gemini API 일시 오류 (${response.status})`);
    } catch (error) { lastError = error; }
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
  }
  throw providerError(lastError?.name === "TimeoutError" ? "Gemini 응답 시간이 초과되었습니다." : "Gemini API에 연결하지 못했습니다.");
}

function providerError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}
