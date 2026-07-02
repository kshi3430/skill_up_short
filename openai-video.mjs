import { synthesizeSpeechWithTunnel } from "./tunnel-tts.mjs";

export async function generateVideoFromScenes({ apiKey, scenes, images, ttsUrl = "", ttsApiKey = "", ttsModel = "", ttsVoice = "default" }) {
  const effectiveApiKey = String(apiKey || "").trim();
  if (!ttsUrl && !effectiveApiKey) {
    const error = new Error("TTS_API_URL 또는 OPENAI_API_KEY가 설정되지 않았습니다.");
    error.statusCode = 400;
    throw error;
  }

  const narration = scenes.slice(0, 4)
    .map((scene) => scene.narration || scene.visual || "")
    .filter(Boolean)
    .join("\n\n");
  let audio;
  if (ttsUrl) {
    try {
      audio = await synthesizeSpeechWithTunnel({ url: ttsUrl, apiKey: ttsApiKey, model: ttsModel, voice: ttsVoice, text: narration });
    } catch (error) {
      if (!effectiveApiKey) throw error;
      audio = await synthesizeSpeech({ apiKey: effectiveApiKey, text: narration });
    }
  } else {
    audio = await synthesizeSpeech({ apiKey: effectiveApiKey, text: narration });
  }
  const videoDataUrl = await buildSimpleMp4FromAudio({ audio, images, scenes });
  return { videoDataUrl };
}

async function synthesizeSpeech({ apiKey, text }) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text,
      voice: "alloy",
      format: "mp3"
    }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data?.error?.message || "TTS 생성에 실패했습니다.");
    error.statusCode = 502;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

async function buildSimpleMp4FromAudio({ audio, images = [], scenes = [] }) {
  const { mkdirSync, rmSync } = await import("node:fs");
  const { writeFile, readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { randomUUID } = await import("node:crypto");
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);

  const tmpDir = path.join(os.tmpdir(), `shorts-video-${randomUUID()}`);
  mkdirSync(tmpDir, { recursive: true });
  try {
    try {
      await execFileAsync("ffmpeg", ["-version"]);
    } catch {
      throw new Error("ffmpeg is not available");
    }

    // The tunnel currently returns WAV while OpenAI returns MP3. ffmpeg detects
    // the actual codec from the bytes, so the neutral extension handles both.
    const audioFile = path.join(tmpDir, "narration.audio");
    await writeFile(audioFile, audio);
    const { stdout: durationOutput } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioFile
    ]);
    const duration = Number.parseFloat(durationOutput.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("TTS 음성 길이를 확인하지 못했습니다.");
    const output = path.join(tmpDir, "output.mp4");

    const sceneImages = Array.isArray(images)
      ? images.slice(0, 4).map((image) => typeof image?.imageDataUrl === "string" ? image.imageDataUrl : "")
      : [];
    const hasAllSceneImages = sceneImages.length === 4 && sceneImages.every(Boolean);

    let ffmpegArgs;
    if (hasAllSceneImages) {
      const sceneDurations = calculateSceneDurations(scenes, duration);
      const imageFiles = [];
      for (const [index, imageDataUrl] of sceneImages.entries()) {
        const match = imageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
        if (!match) throw new Error(`장면 ${index + 1} 이미지 형식이 올바르지 않습니다.`);
        const ext = match[1].split("/")[1];
        const imageFile = path.join(tmpDir, `scene-${index + 1}.${ext === "jpeg" ? "jpg" : ext}`);
        await writeFile(imageFile, Buffer.from(match[2], "base64"));
        imageFiles.push(imageFile);
      }

      const imageInputs = imageFiles.flatMap((imageFile) => ["-i", imageFile]);
      const filters = sceneDurations.map((sceneDuration, index) =>
        `[${index}:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,setsar=1,` +
        `zoompan=z=1:d=${Math.max(1, Math.round(sceneDuration * 24))}:s=540x960:fps=24,` +
        `setpts=PTS-STARTPTS[v${index}]`
      );
      filters.push(`${sceneDurations.map((_, index) => `[v${index}]`).join("")}concat=n=4:v=1:a=0[v]`);
      ffmpegArgs = [
        ...imageInputs,
        "-i", audioFile,
        "-filter_complex", filters.join(";"),
        "-map", "[v]", "-map", "4:a:0",
        "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage",
        "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", output
      ];
    } else {
      ffmpegArgs = [
        "-f", "lavfi", "-i", `color=c=#1f2923:s=540x960:r=24:d=${duration.toFixed(3)}`,
        "-i", audioFile,
        "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
        "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", output
      ];
    }

    await execFileAsync("ffmpeg", ffmpegArgs);

    const buffer = await readFile(output);
    return `data:video/mp4;base64,${buffer.toString("base64")}`;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function calculateSceneDurations(scenes, audioDuration) {
  const fallbackWeights = [3, 5, 22, 10];
  const weights = Array.from({ length: 4 }, (_, index) => {
    const match = String(scenes?.[index]?.range || "").match(/(\d+(?:\.\d+)?)\s*[~～-]\s*(\d+(?:\.\d+)?)/);
    if (!match) return fallbackWeights[index];
    const sceneDuration = Number(match[2]) - Number(match[1]);
    return Number.isFinite(sceneDuration) && sceneDuration > 0 ? sceneDuration : fallbackWeights[index];
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((weight) => audioDuration * weight / totalWeight);
}
