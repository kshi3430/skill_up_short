export async function generateSceneImagesWithGemini({ apiKey, scenes }) {
  const selected = scenes.slice(0, 4);
  return Promise.all(selected.map((scene, index) => generateSceneImageWithGemini({ apiKey, scene, index })));
}

export async function generateSceneImageWithGemini({ apiKey, scene, index = 0 }) {
  const effectiveApiKey = String(apiKey || "").trim();
  if (!effectiveApiKey) {
    const error = new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
    error.statusCode = 400;
    throw error;
  }

  const models = [
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-2.5-flash-image"
  ];

  let lastError;
  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(effectiveApiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: buildImagePrompt(scene, index) }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
        }),
        signal: AbortSignal.timeout(60_000)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        lastError = new Error(data?.error?.message || `Gemini 이미지 생성에 실패했습니다. (${response.status})`);
        continue;
      }

      const data = await response.json();
      const inlineData = data?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.inlineData)
        .find(Boolean);
      const base64 = inlineData?.data;
      if (!base64) {
        lastError = new Error("Gemini가 이미지를 반환하지 않았습니다.");
        continue;
      }

      return {
        index,
        range: scene.range,
        imageDataUrl: `data:${inlineData.mimeType || "image/png"};base64,${base64}`
      };
    } catch (error) {
      lastError = error;
    }
  }

  const error = lastError || new Error("Gemini 이미지 생성에 실패했습니다.");
  error.statusCode = 502;
  throw error;
}

function buildImagePrompt(scene, index) {
  return [
    "Vertical Korean cooking shorts scene, appetizing realistic food photography, warm natural kitchen lighting, clean composition, close-up, smartphone video frame.",
    `Scene ${index + 1}: ${scene.visual}. Narration context: ${scene.narration}`,
    "No text overlay, no logo, no watermark."
  ].join(" ");
}
