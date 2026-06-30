export async function generateSceneImages({ apiKey, scenes }) {
  const selected = scenes.slice(0, 4);
  return Promise.all(selected.map((scene, index) => generateSceneImage({ apiKey, scene, index })));
}

export async function generateSceneImage({ apiKey, scene, index = 0 }) {
  const effectiveApiKey = String(apiKey || "").trim();
  if (!effectiveApiKey) {
    const error = new Error("STABILITY_API_KEY가 설정되지 않았습니다.");
    error.statusCode = 400;
    throw error;
  }
  const form = new FormData();
  form.append("prompt", [
    "Vertical Korean cooking shorts scene, appetizing realistic food photography, warm natural kitchen lighting, clean composition, close-up, smartphone video frame.",
    `Scene ${index + 1}: ${scene.visual}. Narration context: ${scene.narration}`,
    "No text overlay, no logo, no watermark."
  ].join(" "));
  form.append("negative_prompt", "text, captions, logo, watermark, blurry food, distorted utensils, deformed hands, unsafe kitchen behavior");
  form.append("aspect_ratio", "9:16");
  form.append("style_preset", "photographic");
  form.append("output_format", "webp");

  const response = await fetch("https://api.stability.ai/v2beta/stable-image/generate/core", {
    method: "POST",
    headers: { authorization: `Bearer ${effectiveApiKey}`, accept: "image/*" },
    body: form,
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    let message = `Stability 이미지 생성에 실패했습니다. (${response.status})`;
    try { const data = await response.json(); message = data?.errors?.join(" ") || data?.message || message; } catch {}
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }
  const contentType = response.headers.get("content-type") || "image/webp";
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    index,
    range: scene.range,
    imageDataUrl: `data:${contentType};base64,${buffer.toString("base64")}`
  };
}
