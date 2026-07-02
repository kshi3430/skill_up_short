export async function generateSceneImagesWithTunnel({ url, apiKey, model, scenes }) {
  // A single Ollama GPU worker cannot reliably handle four diffusion jobs at
  // once. Generate scenes sequentially, matching the teammate's working curl.
  const images = [];
  for (const [index, scene] of scenes.slice(0, 4).entries()) {
    images.push(await generateOne({ url, apiKey, model, scene, index }));
  }
  return images;
}

async function generateOne({ url, apiKey, model, scene, index }) {
  const prompt = [
    "Vertical Korean cooking shorts scene, appetizing realistic food photography, warm natural kitchen lighting, clean composition, close-up, smartphone video frame.",
    `Scene ${index + 1}: ${scene.visual}. Narration context: ${scene.narration}`,
    "No text overlay, no logo, no watermark."
  ].join(" ");
  const isOllama = new URL(url).pathname.endsWith("/api/generate");
  const requestBody = isOllama
    ? { model, prompt, stream: true, options: { width: 512, height: 512, steps: 4 } }
    : {
        ...(model ? { model } : {}), prompt,
        size: "576x1024", width: 576, height: 1024,
        response_format: "b64_json"
      };
  const response = await fetch(url, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(180_000)
  });
  if (!response.ok) throw await responseError(response, "터널 이미지 생성에 실패했습니다.");
  const imageDataUrl = await extractImage(response);
  return { index, range: scene.range, imageDataUrl };
}

async function extractImage(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.startsWith("image/")) {
    return `data:${contentType.split(";")[0]};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  }
  const rawText = await response.text();
  const data = parseTunnelPayload(rawText);
  const candidate = data?.imageDataUrl || data?.image || data?.b64_json || data?.base64 || data?.data?.[0]?.b64_json || data?.data?.[0]?.url || data?.url;
  if (!candidate) throw serviceError("터널 이미지 API 응답에서 이미지 데이터나 URL을 찾지 못했습니다.");
  if (/^https?:\/\//.test(candidate)) return downloadAsDataUrl(candidate);
  if (String(candidate).startsWith("data:image/")) return candidate;
  return `data:image/png;base64,${candidate}`;
}

function parseTunnelPayload(rawText) {
  if (!rawText) return {};
  try {
    return JSON.parse(rawText);
  } catch {}
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    const payload = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!payload) continue;
    try {
      candidates.push(JSON.parse(payload));
    } catch {
      continue;
    }
  }
  return candidates.at(-1) || {};
}

async function downloadAsDataUrl(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw serviceError("생성된 이미지 URL을 내려받지 못했습니다.");
  const type = response.headers.get("content-type") || "image/png";
  return `data:${type.split(";")[0]};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

function headers(apiKey) {
  return { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

async function responseError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  return serviceError(data?.error?.message || data?.error || data?.message || `${fallback} (${response.status})`);
}

function serviceError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}
