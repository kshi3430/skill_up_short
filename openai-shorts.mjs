import fs from "node:fs";

export const SHORTS_SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "조리 시간을 포함한 쇼츠 제목" },
    thumbnail: { type: "string", description: "짧고 눈에 띄는 썸네일 문구" },
    duration: { type: "integer", enum: [40] },
    scenes: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          range: { type: "string", enum: ["0~3초", "3~8초", "8~30초", "30~40초"] },
          label: { type: "string" },
          narration: { type: "string" },
          visual: { type: "string" }
        },
        required: ["range", "label", "narration", "visual"],
        additionalProperties: false
      }
    },
    hashtags: { type: "array", items: { type: "string" } }
  },
  required: ["title", "thumbnail", "duration", "scenes", "hashtags"],
  additionalProperties: false
};

export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

export function buildFallbackScript(recipe) {
  const ingredientLine = recipe.ingredients.join(", ");
  const stepLines = recipe.steps.map((step, index) => `${index + 1}. ${step}`).join("\n");
  return {
    title: `${recipe.cookTime}분 완성! ${recipe.title}`,
    thumbnail: `${recipe.cookTime}분이면 끝`,
    duration: 40,
    scenes: [
      { range: "0~3초", label: "완성 훅", narration: recipe.hook, visual: `완성된 ${recipe.title}를 가까이 보여준다.` },
      { range: "3~8초", label: "재료", narration: `재료는 ${ingredientLine}. 이것만 준비하세요.`, visual: "재료를 한 화면에 차례로 놓는다." },
      { range: "8~30초", label: "조리", narration: recipe.steps.join(". ") + ".", visual: stepLines },
      { range: "30~40초", label: "완성", narration: `${recipe.tip || "따뜻할 때 바로 드세요."} 저장해 두고 오늘 만들어 보세요!`, visual: "완성 음식 한입과 단면을 보여준다." }
    ],
    hashtags: ["#5분레시피", "#자취요리", "#초간단요리", `#${recipe.category.replaceAll(" ", "")}`],
    source: "template"
  };
}

export function buildRecipePrompt(recipe) {
  return `다음 레시피로 40초짜리 한국어 유튜브 쇼츠 촬영 대본을 작성해줘.
레시피명: ${recipe.title}
카테고리: ${recipe.category}
조리 시간: ${recipe.cookTime}분
재료: ${recipe.ingredients.join(", ")}
과정: ${recipe.steps.join(" / ")}
핵심 훅: ${recipe.hook}
팁: ${recipe.tip || "없음"}

학생, 자취생, 요리 초보자가 바로 따라 할 수 있어야 한다. 과장된 효능이나 확인되지 않은 식품 안전 정보는 쓰지 않는다.
달걀은 흰자와 노른자가 굳도록 익히고, 육류와 해산물은 속까지 완전히 가열한다. 생식이나 덜 익힘을 권하지 않는다. 밀폐 용기, 껍데기째 달걀, 금속을 전자레인지에 넣지 않는다.
반드시 JSON만 출력하고 다음 구조를 지켜라:
{"title":"제목","thumbnail":"썸네일 문구","duration":40,"scenes":[{"range":"0~3초","label":"완성 훅","narration":"...","visual":"..."},{"range":"3~8초","label":"재료","narration":"...","visual":"..."},{"range":"8~30초","label":"조리","narration":"...","visual":"..."},{"range":"30~40초","label":"완성","narration":"...","visual":"..."}],"hashtags":["#태그"]}`;
}

export function buildTitlePrompt(title) {
  return `레시피명 '${title}'만 보고 학생과 자취생이 따라 할 수 있는 1인분 초간단 레시피를 먼저 구상한 뒤, 40초짜리 한국어 유튜브 쇼츠 촬영 대본으로 작성해줘.
- 실제로 필요한 재료와 정확한 분량을 빠짐없이 제시한다.
- 조리 순서는 짧고 명확하게 쓴다.
- 일반적인 식품 안전 수칙을 지키며 익혀야 하는 재료는 충분히 익힌다.
- 달걀은 흰자와 노른자가 굳도록 익히고, 육류와 해산물은 속까지 완전히 가열한다. 생식이나 덜 익힘을 권하지 않는다.
- 밀폐 용기, 껍데기째 달걀, 금속을 전자레인지에 넣는 조리법을 제안하지 않는다.
- 가능하면 5분 안에 완성하고, 어려우면 현실적인 조리 시간을 제목에 표시한다.
- 첫 3초는 완성 음식을 보여주는 강한 훅으로 시작한다.
- 학생, 자취생, 요리 초보자가 이해할 쉬운 표현만 쓴다.

반드시 JSON만 출력하고 다음 구조를 지켜라:
{"title":"제목","thumbnail":"썸네일 문구","duration":40,"scenes":[{"range":"0~3초","label":"완성 훅","narration":"...","visual":"..."},{"range":"3~8초","label":"재료","narration":"재료와 정확한 분량","visual":"..."},{"range":"8~30초","label":"조리","narration":"조리 과정","visual":"단계별 촬영 화면"},{"range":"30~40초","label":"완성","narration":"팁과 저장 유도","visual":"..."}],"hashtags":["#태그"]}`;
}

export function inferRecipeFromTitle(title) {
  const normalized = title.replaceAll(" ", "");
  const profiles = [
    {
      keywords: ["참치", "컵밥"], category: "전자레인지 요리",
      ingredients: ["밥 1공기", "참치 1/2캔", "마요네즈 1큰술", "간장 1작은술", "김가루 약간"],
      steps: ["참치 기름을 빼고 마요네즈와 간장을 섞는다", "따뜻한 밥 위에 참치마요를 올린다", "김가루를 뿌려 마무리한다"],
      tip: "매콤하게 먹고 싶다면 고추장 반 작은술을 더해보세요."
    },
    {
      keywords: ["김치볶음밥"], category: "볶음밥",
      ingredients: ["밥 1공기", "김치 1/2컵", "식용유 1큰술", "간장 1작은술", "참기름 1작은술"],
      steps: ["김치를 잘게 썰어 식용유에 1분 볶는다", "밥과 간장을 넣고 센 불에서 고루 볶는다", "불을 끄고 참기름을 둘러 마무리한다"],
      tip: "찬밥을 사용하면 밥알이 더 고슬고슬해져요."
    },
    {
      keywords: ["볶음밥"], category: "볶음밥",
      ingredients: ["밥 1공기", "달걀 1개", "대파 1/4대", "식용유 1큰술", "간장 1작은술"],
      steps: ["대파를 잘게 썰어 식용유에 볶는다", "달걀을 넣고 빠르게 저어 익힌다", "밥과 간장을 넣고 고슬고슬하게 볶는다"],
      tip: "간장은 팬 가장자리에 넣어 살짝 태우면 향이 좋아져요."
    },
    {
      keywords: ["라면", "라볶이"], category: "라면 응용",
      ingredients: ["라면 1봉", "물 450ml", "대파 약간", "달걀 1개"],
      steps: ["냄비에 물과 수프를 넣고 끓인다", "면과 대파를 넣어 3분 30초 끓인다", "달걀을 넣고 원하는 익힘 정도로 마무리한다"],
      tip: "국물을 진하게 먹고 싶다면 물을 50ml 줄여주세요."
    },
    {
      keywords: ["계란", "달걀", "오믈렛"], category: "계란 요리",
      ingredients: ["달걀 2개", "소금 한 꼬집", "식용유 1작은술", "대파 약간"],
      steps: ["달걀에 소금과 다진 대파를 넣고 푼다", "중약불로 달군 팬에 식용유를 두르고 달걀물을 붓는다", "가장자리가 익으면 접어 속까지 익힌다"],
      tip: "센 불보다 중약불에서 익혀야 부드럽고 타지 않아요."
    },
    {
      keywords: ["두부"], category: "전자레인지 요리",
      ingredients: ["두부 1/2모", "간장 1큰술", "참기름 1작은술", "고춧가루 1/2작은술", "대파 약간"],
      steps: ["두부를 먹기 좋은 크기로 썰어 용기에 담는다", "간장과 참기름, 고춧가루를 섞어 두부에 뿌린다", "전자레인지에 2분 돌리고 대파를 올린다"],
      tip: "두부 물기를 먼저 빼면 양념이 싱거워지지 않아요."
    },
    {
      keywords: ["토스트", "샌드위치"], category: "간단한 간식",
      ingredients: ["식빵 2장", "달걀 1개", "치즈 1장", "버터 1작은술"],
      steps: ["팬에 버터를 녹이고 달걀을 익힌다", "식빵을 앞뒤로 노릇하게 굽는다", "달걀과 치즈를 식빵 사이에 넣는다"],
      tip: "뚜껑을 30초 덮으면 치즈가 고르게 녹아요."
    }
  ];
  const profile = profiles.find((item) => item.keywords.some((keyword) => normalized.includes(keyword))) || {
    category: "간단한 간식",
    ingredients: [`${title} 주재료 1인분`, "식용유 1작은술", "소금 또는 간장 약간"],
    steps: ["주재료를 먹기 좋은 크기로 손질한다", "팬이나 전자레인지로 속까지 충분히 익힌다", "간을 맞춘 뒤 그릇에 담아 마무리한다"],
    tip: "조리 도구와 재료에 따라 익는 시간이 다르니 중간에 상태를 확인하세요."
  };
  return {
    title, category: profile.category, cookTime: 5,
    ingredients: profile.ingredients, steps: profile.steps,
    hook: `이 ${title}, 복잡해 보여도 5분이면 충분해요.`, tip: profile.tip
  };
}

export async function generateRecipeScript({ apiKey, model, recipe, useAI = true }) {
  if (!useAI || !apiKey) return buildFallbackScript(recipe);
  return requestAIScript({ apiKey, model, prompt: buildRecipePrompt(recipe) });
}

export async function generateRecipeScriptFromTitle({ apiKey, model, title, useAI = true }) {
  if (!useAI || !apiKey) return buildFallbackScript(inferRecipeFromTitle(title));
  return requestAIScript({ apiKey, model, prompt: buildTitlePrompt(title) });
}

async function requestAIScript({ apiKey, model, prompt }) {
  const request = {
    model,
    reasoning: { effort: "none" },
    max_output_tokens: 1000,
    instructions: "너는 초간단 요리 숏츠 전문 작가다. 정확한 1인분 재료와 안전한 조리법을 사용하고 항상 한국어로 작성한다.",
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "recipe_shorts_script",
        strict: true,
        schema: SHORTS_SCRIPT_SCHEMA
      }
    }
  };
  const response = await fetchWithRetry("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(request)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "AI 대본 생성에 실패했습니다.");
  const text = extractOutputText(data);
  try {
    const script = JSON.parse(text);
    validateGeneratedScript(script);
    return { ...script, source: "ai" };
  } catch {
    throw new Error("AI가 올바른 대본 형식을 반환하지 않았습니다.");
  }
}

async function fetchWithRetry(url, options, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
      if (response.ok || (response.status !== 429 && response.status < 500)) return response;
      lastError = new Error(`OpenAI API 일시 오류 (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts) await wait(300 * 2 ** (attempt - 1));
  }
  throw new Error(lastError?.name === "TimeoutError" ? "AI 응답 시간이 초과되었습니다. 다시 시도해주세요." : "OpenAI API에 연결하지 못했습니다.");
}

function validateGeneratedScript(script) {
  const ranges = ["0~3초", "3~8초", "8~30초", "30~40초"];
  if (!script || script.duration !== 40 || !Array.isArray(script.scenes) || script.scenes.length !== 4) throw new Error("invalid script");
  if (!script.scenes.every((scene, index) => scene.range === ranges[index] && scene.narration && scene.visual)) throw new Error("invalid scenes");
  if (!script.title || !script.thumbnail || !Array.isArray(script.hashtags)) throw new Error("invalid metadata");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractOutputText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  const parts = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) if (typeof content?.text === "string") parts.push(content.text);
  }
  return parts.join("\n").trim();
}
