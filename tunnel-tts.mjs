export async function synthesizeSpeechWithTunnel({ url, apiKey, model, voice, text }) {
  const endpoint = new URL(url);
  const usesQueryApi = endpoint.pathname.endsWith("/api/tts");
  if (usesQueryApi) endpoint.searchParams.set("text", text);
  const response = await fetch(endpoint, {
    method: usesQueryApi ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: usesQueryApi ? undefined : JSON.stringify({
      ...(model ? { model } : {}), input: text, text,
      voice: voice || "default", speaker: voice || "default",
      language: "ko", response_format: "mp3", format: "mp3"
    }),
    signal: AbortSignal.timeout(300_000)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw serviceError(data?.error?.message || data?.error || data?.message || `터널 TTS 호출에 실패했습니다. (${response.status})`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.startsWith("audio/") || contentType === "application/octet-stream") return Buffer.from(await response.arrayBuffer());
  const data = await response.json();
  const candidate = data?.audioDataUrl || data?.audio || data?.b64_json || data?.base64 || data?.data?.audio || data?.data?.url || data?.url;
  if (!candidate) throw serviceError("터널 TTS 응답에서 음성 데이터나 URL을 찾지 못했습니다.");
  if (/^https?:\/\//.test(candidate)) {
    const audio = await fetch(candidate, { signal: AbortSignal.timeout(60_000) });
    if (!audio.ok) throw serviceError("생성된 음성 URL을 내려받지 못했습니다.");
    return Buffer.from(await audio.arrayBuffer());
  }
  const base64 = String(candidate).replace(/^data:audio\/[^;]+;base64,/, "");
  return Buffer.from(base64, "base64");
}

function serviceError(message) {
  const error = new Error(message);
  error.statusCode = 502;
  return error;
}
