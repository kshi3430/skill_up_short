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
  const videoDataUrl = await buildSimpleMp4FromAudio({ audio, images });
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

async function buildSimpleMp4FromAudio({ audio, images = [] }) {
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

    const firstImage = Array.isArray(images) ? images.find((image) => typeof image?.imageDataUrl === "string") : null;
    const imageDataUrl = firstImage?.imageDataUrl || "";

    let ffmpegArgs;
    if (imageDataUrl) {
      const match = imageDataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const ext = match[1].split("/")[1] || "png";
        const imageFile = path.join(tmpDir, `scene.${ext === "jpeg" ? "jpg" : ext}`);
        await writeFile(imageFile, Buffer.from(match[2], "base64"));
        ffmpegArgs = [
          "-loop", "1", "-i", imageFile,
          "-i", audioFile,
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
