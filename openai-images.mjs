export async function generateSceneImagesWithOpenAI({ apiKey, scenes }) {
  const selected = scenes.slice(0, 4);
  return Promise.all(selected.map((scene, index) => generateSceneImageWithOpenAI({ apiKey, scene, index })));
}

export async function generateSceneImageWithOpenAI({ apiKey, scene, index = 0 }) {
  const effectiveApiKey = String(apiKey || "").trim();
  if (!effectiveApiKey) {
    const error = new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
    error.statusCode = 400;
    throw error;
  }

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${effectiveApiKey}`
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: [
        "Vertical Korean cooking shorts scene, appetizing realistic food photography, warm natural kitchen lighting, clean composition, close-up, smartphone video frame.",
        `Scene ${index + 1}: ${scene.visual}. Narration context: ${scene.narration}`,
        "No text overlay, no logo, no watermark."
      ].join(" "),
      size: "1024x1536",
      quality: "high"
    }),
    signal: AbortSignal.timeout(60_000)
  });

  if (!response.ok) {
    let message = `OpenAI 이미지 생성에 실패했습니다. (${response.status})`;
    try { const data = await response.json(); message = data?.error?.message || data?.message || message; } catch {}
    const error = new Error(message);
    error.statusCode = 502;
    throw error;
  }

  const data = await response.json();
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) {
    const error = new Error("OpenAI가 이미지를 반환하지 않았습니다.");
    error.statusCode = 502;
    throw error;
  }

  return {
    index,
    range: scene.range,
    imageDataUrl: `data:image/png;base64,${base64}`
  };
}
