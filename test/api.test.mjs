import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonDatabase } from "../db.mjs";
import { createApp } from "../server.mjs";
import { generateRecipeScriptFromTitle } from "../openai-shorts.mjs";
import { generateGeminiScriptFromTitle } from "../gemini-shorts.mjs";
import { generateSceneImage } from "../stability-images.mjs";

async function withServer(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "",
    geminiApiKey: "",
    stabilityApiKey: ""
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  try { await run(baseUrl); }
  finally { await new Promise((resolve) => app.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); }
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

test("헬스 체크와 초기 대시보드를 반환한다", () => withServer(async (baseUrl) => {
  const health = await request(baseUrl, "/api/health");
  assert.equal(health.response.status, 200);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.aiEnabled, false);
  assert.equal(health.data.model, "gpt-5.4-nano");
  assert.equal(health.data.textProvider, "template");
  assert.equal(health.data.imageEnabled, false);
  const dashboard = await request(baseUrl, "/api/dashboard");
  assert.equal(dashboard.data.stats.totalRecipes, 3);
  assert.ok(Array.isArray(dashboard.data.upcoming));
}));

test("레시피 CRUD와 검색이 동작한다", () => withServer(async (baseUrl) => {
  const payload = {
    title: "참치 마요 컵밥", category: "전자레인지 요리", difficulty: "매우 쉬움",
    cookTime: 5, cost: 2800, ingredients: ["밥 1공기", "참치 1/2캔", "마요네즈 1큰술"],
    steps: ["재료를 용기에 담는다", "전자레인지에 2분 돌린다"], hook: "설거지 하나로 끝나는 컵밥입니다.", tip: "김가루를 더해보세요.", status: "draft"
  };
  const created = await request(baseUrl, "/api/recipes", { method: "POST", body: payload });
  assert.equal(created.response.status, 201);
  assert.equal(created.data.title, payload.title);

  const search = await request(baseUrl, "/api/recipes?q=참치");
  assert.ok(search.data.some((recipe) => recipe.id === created.data.id));

  const updated = await request(baseUrl, `/api/recipes/${created.data.id}`, { method: "PUT", body: { ...payload, status: "ready" } });
  assert.equal(updated.data.status, "ready");

  const deleted = await request(baseUrl, `/api/recipes/${created.data.id}`, { method: "DELETE" });
  assert.equal(deleted.response.status, 204);
  const missing = await request(baseUrl, `/api/recipes/${created.data.id}`);
  assert.equal(missing.response.status, 404);
}));

test("일정 생성과 규칙 기반 40초 대본 생성이 동작한다", () => withServer(async (baseUrl) => {
  const recipes = await request(baseUrl, "/api/recipes");
  const recipeId = recipes.data[0].id;
  const schedule = await request(baseUrl, "/api/schedules", { method: "POST", body: { recipeId, publishAt: "2026-07-06T18:00:00+09:00", status: "scheduled" } });
  assert.equal(schedule.response.status, 201);
  assert.equal(schedule.data.recipe.id, recipeId);

  const script = await request(baseUrl, "/api/generate-script", { method: "POST", body: { recipeId } });
  assert.equal(script.response.status, 200);
  assert.equal(script.data.duration, 40);
  assert.equal(script.data.scenes.length, 4);
  assert.equal(script.data.source, "template");
}));

test("저장하지 않은 사용자 입력 레시피로 대본을 생성한다", () => withServer(async (baseUrl) => {
  const script = await request(baseUrl, "/api/generate-script", {
    method: "POST",
    body: {
      recipe: {
        title: "두부 김치 덮밥",
        category: "전자레인지 요리",
        cookTime: 5,
        cost: 0,
        difficulty: "쉬움",
        ingredients: ["두부 1/2모", "김치 3큰술", "밥 1공기"],
        steps: ["두부와 김치를 용기에 담는다", "전자레인지에 3분 돌린다", "밥 위에 올린다"],
        hook: "두부와 김치만 있으면 5분 한 끼 완성!",
        tip: "참기름을 조금 둘러주세요.",
        status: "draft"
      }
    }
  });
  assert.equal(script.response.status, 200);
  assert.match(script.data.title, /두부 김치 덮밥/);
  assert.equal(script.data.scenes.length, 4);
}));

test("레시피명 하나만 입력해 재료와 40초 대본을 자동 구성한다", () => withServer(async (baseUrl) => {
  const script = await request(baseUrl, "/api/generate-script", {
    method: "POST",
    body: { title: "참치마요 컵밥" }
  });
  assert.equal(script.response.status, 200);
  assert.match(script.data.title, /참치마요 컵밥/);
  assert.match(script.data.scenes[1].narration, /참치/);
  assert.equal(script.data.scenes.length, 4);
}));

test("잘못된 레시피 입력을 400으로 거절한다", () => withServer(async (baseUrl) => {
  const invalid = await request(baseUrl, "/api/recipes", { method: "POST", body: { title: "" } });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.data.error, /레시피명/);
}));

test("API 키가 있으면 Responses API와 엄격한 JSON Schema를 사용한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        title: "5분 완성 참치마요 컵밥",
        thumbnail: "5분 한 끼",
        duration: 40,
        scenes: [
          { range: "0~3초", label: "완성 훅", narration: "5분이면 완성!", visual: "완성 컵밥을 보여준다." },
          { range: "3~8초", label: "재료", narration: "밥과 참치를 준비하세요.", visual: "재료를 펼친다." },
          { range: "8~30초", label: "조리", narration: "재료를 섞어 밥에 올립니다.", visual: "조리 과정을 보여준다." },
          { range: "30~40초", label: "완성", narration: "김가루를 올리고 드세요.", visual: "한입 먹는 장면을 보여준다." }
        ],
        hashtags: ["#5분레시피", "#자취요리"]
      })
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const result = await generateRecipeScriptFromTitle({ apiKey: "test-key", model: "gpt-5.4-nano", title: "참치마요 컵밥" });
    assert.equal(result.source, "ai");
    assert.equal(capturedRequest.url, "https://api.openai.com/v1/responses");
    assert.equal(capturedRequest.options.headers.Authorization, "Bearer test-key");
    assert.equal(capturedRequest.body.text.format.type, "json_schema");
    assert.equal(capturedRequest.body.text.format.strict, true);
    assert.equal(capturedRequest.body.text.format.schema.additionalProperties, false);
    assert.equal(capturedRequest.body.model, "gpt-5.4-nano");
    assert.equal(capturedRequest.body.reasoning.effort, "none");
    assert.equal(capturedRequest.body.max_output_tokens, 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Gemini 키가 있으면 Flash-Lite와 구조화 출력을 사용한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  const script = {
    title: "5분 완성 계란밥", thumbnail: "달걀 2개면 끝", duration: 40,
    scenes: [
      { range: "0~3초", label: "완성 훅", narration: "5분이면 완성!", visual: "완성 계란밥을 보여준다." },
      { range: "3~8초", label: "재료", narration: "밥과 달걀을 준비하세요.", visual: "재료를 펼친다." },
      { range: "8~30초", label: "조리", narration: "달걀을 익혀 밥에 올립니다.", visual: "조리 과정을 보여준다." },
      { range: "30~40초", label: "완성", narration: "참기름을 둘러 드세요.", visual: "한입 먹는 장면을 보여준다." }
    ],
    hashtags: ["#5분레시피"]
  };
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(script) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await generateGeminiScriptFromTitle({ apiKey: "gemini-test", title: "계란밥" });
    assert.equal(result.source, "gemini");
    assert.match(capturedRequest.url, /gemini-2\.5-flash-lite:generateContent$/);
    assert.equal(capturedRequest.options.headers["x-goog-api-key"], "gemini-test");
    assert.equal(capturedRequest.body.generationConfig.responseMimeType, "application/json");
    assert.equal(capturedRequest.body.generationConfig.maxOutputTokens, 1000);
    assert.match(capturedRequest.body.systemInstruction.parts[0].text, /노른자까지 완전히 익힌다/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Gemini 호출이 실패하면 템플릿 대본으로 자동 대체한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return new Response(JSON.stringify({ error: { message: "API key invalid" } }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "",
    geminiApiKey: "gemini-test",
    stabilityApiKey: ""
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await request(baseUrl, "/api/generate-script", { method: "POST", body: { title: "계란밥" } });
    assert.equal(response.response.status, 200);
    assert.equal(response.data.source, "template");
    assert.match(response.data.title, /계란밥/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test("Gemini가 생달걀 조리법을 반환하면 안전한 결과로 자동 재생성한다", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const base = {
    title: "계란밥", thumbnail: "5분 계란밥", duration: 40, hashtags: ["#계란밥"]
  };
  const unsafe = { ...base, scenes: [
    { range: "0~3초", label: "완성 훅", narration: "생노른자를 톡 올려요.", visual: "생노른자 클로즈업" },
    { range: "3~8초", label: "재료", narration: "밥과 계란", visual: "재료" },
    { range: "8~30초", label: "조리", narration: "노른자를 밥에 비벼요.", visual: "비비기" },
    { range: "30~40초", label: "완성", narration: "완성", visual: "완성 음식" }
  ] };
  const safe = { ...base, scenes: [
    { range: "0~3초", label: "완성 훅", narration: "완전히 익힌 계란밥이에요.", visual: "완성 계란밥" },
    { range: "3~8초", label: "재료", narration: "밥과 달걀", visual: "재료" },
    { range: "8~30초", label: "조리", narration: "달걀을 노른자까지 완전히 익혀 밥에 올려요.", visual: "계란 프라이 익히기" },
    { range: "30~40초", label: "완성", narration: "완성", visual: "완성 음식" }
  ] };
  globalThis.fetch = async () => {
    calls += 1;
    const script = calls === 1 ? unsafe : safe;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(script) }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await generateGeminiScriptFromTitle({ apiKey: "gemini-test", title: "계란밥" });
    assert.equal(calls, 2);
    assert.match(result.scenes[2].narration, /완전히 익혀/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Stability 키가 없으면 이미지 생성 요청을 400으로 거절한다", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "",
    geminiApiKey: "",
    stabilityApiKey: ""
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await request(baseUrl, "/api/generate-images", {
      method: "POST",
      body: { scenes: [{ range: "0~3초", narration: "완성", visual: "완성된 계란밥" }, { range: "3~8초", narration: "재료", visual: "재료" }, { range: "8~30초", narration: "조리", visual: "조리" }, { range: "30~40초", narration: "완성", visual: "완성" }] }
    });
    assert.equal(response.response.status, 400);
    assert.match(response.data.error, /STABILITY_API_KEY/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Stability 키가 있으면 공식 Core API로 9:16 이미지를 생성한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { "Content-Type": "image/webp" } });
  };
  try {
    const result = await generateSceneImage({ apiKey: "stability-test", scene: { range: "0~3초", narration: "완성!", visual: "계란밥 클로즈업" } });
    assert.equal(capturedRequest.url, "https://api.stability.ai/v2beta/stable-image/generate/core");
    assert.equal(capturedRequest.options.headers.authorization, "Bearer stability-test");
    assert.equal(capturedRequest.options.body.get("aspect_ratio"), "9:16");
    assert.equal(capturedRequest.options.body.get("output_format"), "webp");
    assert.match(result.imageDataUrl, /^data:image\/webp;base64,/);
  } finally { globalThis.fetch = originalFetch; }
});
