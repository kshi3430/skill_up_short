import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { JsonDatabase } from "./db.mjs";
import { buildFallbackScript, generateRecipeScript, generateRecipeScriptFromTitle, inferRecipeFromTitle, loadEnvFile } from "./openai-shorts.mjs";
import { generateGeminiScriptFromRecipe, generateGeminiScriptFromTitle } from "./gemini-shorts.mjs";
import { generateSceneImages } from "./stability-images.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
loadEnvFile(path.join(__dirname, ".env"));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

export function createApp(options = {}) {
  return http.createServer(createRequestHandler(options));
}

export function createRequestHandler({
  database,
  apiKey = process.env.OPENAI_API_KEY || "",
  geminiApiKey = process.env.GEMINI_API_KEY || "",
  stabilityApiKey = process.env.STABILITY_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-5.4-nano"
} = {}) {
  const effectiveApiKey = normalizeApiKey(apiKey);
  const effectiveGeminiApiKey = normalizeApiKey(geminiApiKey);
  const effectiveStabilityApiKey = normalizeApiKey(stabilityApiKey);
  const databasePath = process.env.VERCEL
    ? path.join("/tmp", "five-minute-recipe-db.json")
    : path.join(__dirname, "data", "db.json");
  const db = database || new JsonDatabase(databasePath);

  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, {
        ok: true,
        aiEnabled: Boolean(effectiveGeminiApiKey || effectiveApiKey),
        textProvider: effectiveGeminiApiKey ? "gemini" : effectiveApiKey ? "openai" : "template",
        imageEnabled: Boolean(effectiveStabilityApiKey),
        model: effectiveGeminiApiKey ? "gemini-2.5-flash-lite" : model
      });
      if (req.method === "GET" && url.pathname === "/api/dashboard") return json(res, 200, db.dashboard());

      if (url.pathname === "/api/recipes" && req.method === "GET") {
        return json(res, 200, db.listRecipes({ query: url.searchParams.get("q") || "", category: url.searchParams.get("category") || "전체", status: url.searchParams.get("status") || "전체" }));
      }
      if (url.pathname === "/api/recipes" && req.method === "POST") {
        const input = validateRecipe(await readJson(req));
        return json(res, 201, db.createRecipe(input));
      }
      if (parts[0] === "api" && parts[1] === "recipes" && parts[2]) {
        const id = decodeURIComponent(parts[2]);
        if (req.method === "GET") {
          const recipe = db.getRecipe(id);
          return recipe ? json(res, 200, recipe) : json(res, 404, { error: "레시피를 찾을 수 없습니다." });
        }
        if (req.method === "PUT") {
          const recipe = db.updateRecipe(id, validateRecipe(await readJson(req)));
          return recipe ? json(res, 200, recipe) : json(res, 404, { error: "레시피를 찾을 수 없습니다." });
        }
        if (req.method === "DELETE") return db.deleteRecipe(id) ? empty(res, 204) : json(res, 404, { error: "레시피를 찾을 수 없습니다." });
      }

      if (url.pathname === "/api/schedules" && req.method === "GET") return json(res, 200, db.listSchedules());
      if (url.pathname === "/api/schedules" && req.method === "POST") {
        const input = validateSchedule(await readJson(req));
        const schedule = db.createSchedule(input);
        return schedule ? json(res, 201, schedule) : json(res, 400, { error: "존재하지 않는 레시피입니다." });
      }
      if (parts[0] === "api" && parts[1] === "schedules" && parts[2]) {
        const id = decodeURIComponent(parts[2]);
        if (req.method === "PATCH") {
          const body = await readJson(req);
          const input = {};
          if (body.status) input.status = enumValue(body.status, ["planned", "scheduled", "published"], "일정 상태");
          if (body.publishAt) input.publishAt = validDate(body.publishAt);
          const schedule = db.updateSchedule(id, input);
          return schedule ? json(res, 200, schedule) : json(res, 404, { error: "일정을 찾을 수 없습니다." });
        }
        if (req.method === "DELETE") return db.deleteSchedule(id) ? empty(res, 204) : json(res, 404, { error: "일정을 찾을 수 없습니다." });
      }

      if (url.pathname === "/api/generate-script" && req.method === "POST") {
        const body = await readJson(req);
        if (body.title && !body.recipe && !body.recipeId) {
          const title = requiredText(body.title, "레시피명", 60);
          const result = effectiveGeminiApiKey
            ? await generateGeminiScriptWithFallback({ apiKey: effectiveGeminiApiKey, title, type: "title" })
            : await generateRecipeScriptFromTitle({ apiKey: effectiveApiKey, model, title, useAI: Boolean(effectiveApiKey) });
          return json(res, 200, result);
        }
        const recipe = body.recipeId ? db.getRecipe(String(body.recipeId)) : validateRecipe(body.recipe || body);
        if (!recipe) return json(res, 404, { error: "레시피를 찾을 수 없습니다." });
        const result = effectiveGeminiApiKey
          ? await generateGeminiScriptWithFallback({ apiKey: effectiveGeminiApiKey, recipe, type: "recipe" })
          : await generateRecipeScript({ apiKey: effectiveApiKey, model, recipe, useAI: Boolean(effectiveApiKey) });
        return json(res, 200, result);
      }

      if (url.pathname === "/api/generate-images" && req.method === "POST") {
        if (!effectiveStabilityApiKey) return json(res, 400, { error: "STABILITY_API_KEY가 설정되지 않았습니다." });
        const body = await readJson(req);
        const scenes = validateScenes(body.scenes);
        return json(res, 200, { provider: "stability", images: await generateSceneImages({ apiKey: effectiveStabilityApiKey, scenes }) });
      }

      if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "API 경로를 찾을 수 없습니다." });
      return serveStatic(res, url.pathname);
    } catch (error) {
      const status = error.statusCode || 500;
      return json(res, status, { error: status === 500 ? "서버에서 오류가 발생했습니다." : error.message });
    }
  };

  function serveStatic(res, pathname) {
    const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(publicDir, requested);
    if (!filePath.startsWith(`${publicDir}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return json(res, 404, { error: "페이지를 찾을 수 없습니다." });
    }
    res.writeHead(200, { "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(filePath).pipe(res);
  }
}

export default createRequestHandler();

async function generateGeminiScriptWithFallback({ apiKey, title, recipe, type }) {
  try {
    if (type === "title") {
      return await generateGeminiScriptFromTitle({ apiKey, title });
    }
    return await generateGeminiScriptFromRecipe({ apiKey, recipe });
  } catch (error) {
    const fallbackRecipe = recipe || inferRecipeFromTitle(title);
    return { ...buildFallbackScript(fallbackRecipe), source: "template" };
  }
}

function normalizeApiKey(value) {
  return String(value || "").trim();
}

function validateRecipe(body) {
  const title = requiredText(body.title, "레시피명", 60);
  const category = enumValue(body.category, ["계란 요리", "볶음밥", "라면 응용", "전자레인지 요리", "간단한 간식"], "카테고리");
  const cookTime = numeric(body.cookTime, "조리 시간", 1, 60);
  const ingredients = stringList(body.ingredients, "재료", 1, 15);
  const steps = stringList(body.steps, "조리 과정", 1, 12);
  return {
    title,
    category,
    difficulty: enumValue(body.difficulty || "쉬움", ["매우 쉬움", "쉬움", "보통"], "난이도"),
    cookTime,
    cost: numeric(body.cost ?? 0, "예상 비용", 0, 100000),
    ingredients,
    steps,
    hook: requiredText(body.hook || `${cookTime}분 만에 만드는 ${title}`, "영상 훅", 120),
    tip: optionalText(body.tip, 160),
    status: enumValue(body.status || "draft", ["draft", "ready", "published"], "상태")
  };
}

function validateSchedule(body) {
  return {
    recipeId: requiredText(body.recipeId, "레시피", 80),
    publishAt: validDate(body.publishAt),
    platform: "YouTube Shorts",
    status: enumValue(body.status || "planned", ["planned", "scheduled", "published"], "일정 상태")
  };
}

function validateScenes(value) {
  if (!Array.isArray(value) || value.length !== 4) throw badRequest("이미지를 만들 4개 장면이 필요합니다.");
  return value.map((scene) => ({
    range: requiredText(scene?.range, "장면 시간", 20),
    narration: requiredText(scene?.narration, "내레이션", 1000),
    visual: requiredText(scene?.visual, "촬영 화면", 1000)
  }));
}

function requiredText(value, label, max) {
  const text = String(value || "").trim();
  if (!text) throw badRequest(`${label}을(를) 입력해주세요.`);
  if (text.length > max) throw badRequest(`${label}은(는) ${max}자 이하여야 합니다.`);
  return text;
}
function optionalText(value, max) { const text = String(value || "").trim(); return text.slice(0, max); }
function enumValue(value, values, label) { if (!values.includes(value)) throw badRequest(`${label} 값이 올바르지 않습니다.`); return value; }
function numeric(value, label, min, max) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${label}은(는) ${min}~${max} 사이여야 합니다.`); return Math.round(n); }
function stringList(value, label, min, max) {
  const list = (Array.isArray(value) ? value : String(value || "").split("\n")).map((item) => String(item).trim()).filter(Boolean);
  if (list.length < min || list.length > max) throw badRequest(`${label}은(는) ${min}~${max}개 입력해주세요.`);
  return list.map((item) => item.slice(0, 100));
}
function validDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw badRequest("업로드 날짜가 올바르지 않습니다."); return date.toISOString(); }
function badRequest(message) { const error = new Error(message); error.statusCode = 400; return error; }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) { const error = badRequest("요청 데이터가 너무 큽니다."); reject(error); req.destroy(); }
    });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(badRequest("JSON 형식이 올바르지 않습니다.")); } });
    req.on("error", reject);
  });
}
function json(res, status, payload) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(payload)); }
function empty(res, status) { res.writeHead(status); res.end(); }

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "127.0.0.1";
  createApp().listen(port, host, () => console.log(`5분 레시피 스튜디오: http://${host}:${port}`));
}
