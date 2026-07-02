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
import { generateOllamaScriptFromTitle } from "../ollama-shorts.mjs";
import { generateSceneImagesWithTunnel } from "../tunnel-images.mjs";
import { synthesizeSpeechWithTunnel } from "../tunnel-tts.mjs";

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
  const text = await response.text();
  const data = response.status === 204 || !text ? null : JSON.parse(text);
  return { response, data, rawText: text };
}

async function waitForImageJob(baseUrl, jobId) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await request(baseUrl, `/api/image-jobs/${encodeURIComponent(jobId)}`);
    if (status.data?.status === "completed") return status.data;
    if (status.data?.status === "failed") throw new Error(status.data.error || "이미지 작업 실패");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("이미지 작업이 너무 오래 걸립니다.");
}

function testWavBuffer() {
  const sampleRate = 8000;
  const samples = sampleRate / 4;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + dataSize, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(dataSize, 40);
  return buffer;
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

test("Ollama 대본 생성이 실패하면 OpenAI 대본으로 자동 대체한다", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("127.0.0.1:11434")) {
      return new Response(JSON.stringify({ error: "down" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("api.openai.com/v1/responses")) {
      openaiCalls += 1;
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
    }
    return originalFetch(url, options);
  };

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "openai-test",
    geminiApiKey: "",
    stabilityApiKey: "",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5-coder:3b"
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await request(baseUrl, "/api/generate-script", { method: "POST", body: { title: "참치마요 컵밥" } });
    assert.equal(response.response.status, 200);
    assert.equal(response.data.source, "ai");
    assert.equal(openaiCalls, 1);
    assert.match(response.data.title, /참치마요 컵밥/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
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

test("터널 이미지가 실패하면 OpenAI 이미지로 자동 대체한다", async () => {
  const originalFetch = globalThis.fetch;
  let openaiCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("image.example")) {
      return new Response(JSON.stringify({ error: "down" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("api.openai.com/v1/images/generations")) {
      openaiCalls += 1;
      return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "openai-test",
    geminiApiKey: "",
    stabilityApiKey: "",
    imageApiUrl: "https://image.example/api/generate",
    imageModel: "x/flux2-klein:latest"
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await request(baseUrl, "/api/generate-images", {
      method: "POST",
      body: { scenes: [{ range: "0~3초", narration: "완성", visual: "완성된 계란밥" }, { range: "3~8초", narration: "재료", visual: "재료" }, { range: "8~30초", narration: "조리", visual: "조리" }, { range: "30~40초", narration: "완성", visual: "완성" }] }
    });
    assert.equal(response.response.status, 202);
    const job = await waitForImageJob(baseUrl, response.data.jobId);
    assert.equal(job.provider, "openai");
    assert.equal(job.status, "completed");
    assert.equal(openaiCalls, 4);
    assert.match(job.images[0].imageDataUrl, /^data:image\/png;base64,/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test("영상 생성 API가 이미지 없이 대본 음성으로 mp4를 반환한다", async () => {
  const originalFetch = globalThis.fetch;
  let ttsCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("tts.example")) {
      return new Response(JSON.stringify({ error: "down" }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).includes("api.openai.com/v1/audio/speech")) {
      ttsCalls += 1;
      return new Response(testWavBuffer(), { status: 200, headers: { "Content-Type": "audio/wav" } });
    }
    if (String(url).includes("api.openai.com")) {
      return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "openai-test",
    geminiApiKey: "",
    stabilityApiKey: "",
    ttsApiUrl: "https://tts.example/api/tts",
    ttsApiKey: "tts-token",
    ttsModel: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
    ttsVoice: "default"
  });
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await request(baseUrl, "/api/generate-video", {
      method: "POST",
      body: {
        scenes: [
          { range: "0~3초", narration: "첫 번째 장면", visual: "완성된 계란밥" },
          { range: "3~8초", narration: "두 번째 장면", visual: "재료" },
          { range: "8~30초", narration: "세 번째 장면", visual: "조리" },
          { range: "30~40초", narration: "네 번째 장면", visual: "완성" }
        ],
        images: [{ imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAIAAeIhvAAAAAElFTkSuQmCC" }]
      }
    });
    assert.equal(response.response.status, 200);
    assert.equal(ttsCalls, 1);
    assert.match(response.data.videoDataUrl, /^data:video\/mp4;base64,/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
  }
});

test("OpenAI 키가 있으면 GPT 이미지 생성 API로 이미지를 생성한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("api.openai.com")) {
      capturedRequest = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return originalFetch(url, options);
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-studio-"));
  const app = createApp({
    database: new JsonDatabase(path.join(directory, "db.json")),
    apiKey: "openai-test",
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
    assert.equal(response.response.status, 202);
    const job = await waitForImageJob(baseUrl, response.data.jobId);
    assert.equal(job.provider, "openai");
    assert.equal(capturedRequest.url, "https://api.openai.com/v1/images/generations");
    assert.equal(capturedRequest.options.headers.Authorization, "Bearer openai-test");
    assert.equal(capturedRequest.body.model, "gpt-image-1");
    assert.match(job.images[0].imageDataUrl, /^data:image\/png;base64,/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
    globalThis.fetch = originalFetch;
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

test("Ollama qwen2.5에 JSON Schema 대본을 요청한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  const script = {
    title: "5분 계란밥", thumbnail: "달걀 한 끼", duration: 40,
    scenes: [
      { range: "0~3초", label: "완성 훅", narration: "완성", visual: "완성 음식" },
      { range: "3~8초", label: "재료", narration: "재료", visual: "재료" },
      { range: "8~30초", label: "조리", narration: "익힌다", visual: "조리" },
      { range: "30~40초", label: "완성", narration: "먹는다", visual: "완성" }
    ],
    hashtags: ["#계란밥"]
  };
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ message: { content: JSON.stringify(script) } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await generateOllamaScriptFromTitle({ baseUrl: "http://127.0.0.1:11434/", model: "qwen2.5:7b", title: "계란밥" });
    assert.equal(result.source, "ollama");
    assert.equal(capturedRequest.url, "http://127.0.0.1:11434/api/chat");
    assert.equal(capturedRequest.body.model, "qwen2.5:7b");
    assert.equal(capturedRequest.body.stream, false);
    assert.equal(capturedRequest.body.format.type, "object");
  } finally { globalThis.fetch = originalFetch; }
});

test("터널 이미지 API의 OpenAI 호환 base64 응답을 처리한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ data: [{ b64_json: "dGVzdA==" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const images = await generateSceneImagesWithTunnel({
      url: "https://image.example/generate", apiKey: "image-token", model: "local-image",
      scenes: [{ range: "0~3초", narration: "완성", visual: "계란밥" }]
    });
    assert.equal(capturedRequest.options.headers.Authorization, "Bearer image-token");
    assert.equal(capturedRequest.body.model, "local-image");
    assert.match(images[0].imageDataUrl, /^data:image\/png;base64,/);
  } finally { globalThis.fetch = originalFetch; }
});

test("터널 TTS API의 음성 바이너리를 처리한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedRequest;
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options, body: JSON.parse(options.body) };
    return new Response(Buffer.from("audio"), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
  };
  try {
    const audio = await synthesizeSpeechWithTunnel({ url: "https://tts.example/tts", apiKey: "tts-token", model: "local-tts", voice: "ko", text: "안녕하세요" });
    assert.equal(capturedRequest.options.headers.Authorization, "Bearer tts-token");
    assert.equal(capturedRequest.body.input, "안녕하세요");
    assert.equal(capturedRequest.body.text, "안녕하세요");
    assert.equal(audio.toString(), "audio");
  } finally { globalThis.fetch = originalFetch; }
});

test("문서형 TTS /api/tts에는 GET 쿼리로 요청한다", async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(Buffer.from("wav"), { status: 200, headers: { "Content-Type": "audio/wav" } });
  };
  try {
    const audio = await synthesizeSpeechWithTunnel({ url: "https://tts.example/api/tts", apiKey: "token", text: "테스트입니다" });
    assert.equal(captured.options.method, "GET");
    assert.match(captured.url, /text=%ED%85%8C%EC%8A%A4%ED%8A%B8%EC%9E%85%EB%8B%88%EB%8B%A4/);
    assert.equal(captured.options.body, undefined);
    assert.equal(audio.toString(), "wav");
  } finally { globalThis.fetch = originalFetch; }
});

test("Ollama 이미지 /api/generate에는 stream=true로 요청한다", async () => {
  const originalFetch = globalThis.fetch;
  let body;
  globalThis.fetch = async (url, options) => {
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ image: "dGVzdA==", done: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const images = await generateSceneImagesWithTunnel({ url: "https://image.example/api/generate", model: "x/flux2-klein:4b", scenes: [{ range: "0~3초", narration: "완성", visual: "계란밥" }] });
    assert.equal(body.stream, true);
    assert.deepEqual(body.options, { width: 512, height: 512, steps: 4 });
    assert.equal(body.width, undefined);
    assert.match(images[0].imageDataUrl, /^data:image\/png;base64,/);
  } finally { globalThis.fetch = originalFetch; }
});

test("Ollama 장면 이미지는 GPU 보호를 위해 순차 생성한다", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return new Response(JSON.stringify({ image: "dGVzdA==", done: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const scenes = Array.from({ length: 4 }, (_, index) => ({ range: `${index}초`, narration: "설명", visual: "음식" }));
    const images = await generateSceneImagesWithTunnel({ url: "https://image.example/api/generate", model: "x/flux2-klein:latest", scenes });
    assert.equal(images.length, 4);
    assert.equal(maxActive, 1);
  } finally { globalThis.fetch = originalFetch; }
});
