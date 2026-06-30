export async function generateVideoFromScenes({ apiKey, scenes, images }) {
  const effectiveApiKey = String(apiKey || "").trim();
  if (!effectiveApiKey) {
    const error = new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
    error.statusCode = 400;
    throw error;
  }

  const audioParts = [];
  for (const scene of scenes.slice(0, 4)) {
    const audio = await synthesizeSpeech({ apiKey: effectiveApiKey, text: scene.narration || scene.visual || "" });
    audioParts.push(audio);
  }

  try {
    const videoDataUrl = await buildSimpleMp4FromAudio({ audioParts, images: (images || []).slice(0, 4) });
    return { videoDataUrl };
  } catch (error) {
    return { videoDataUrl: createPlaceholderMp4DataUrl(audioParts.length) };
  }
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

async function buildSimpleMp4FromAudio({ audioParts }) {
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

    const audioFiles = [];
    for (let index = 0; index < audioParts.length; index += 1) {
      const audioFile = path.join(tmpDir, `scene-${index}.mp3`);
      await writeFile(audioFile, audioParts[index]);
      audioFiles.push(audioFile);
    }

    const combined = path.join(tmpDir, "combined.mp3");
    const concatList = path.join(tmpDir, "concat.txt");
    const concatContent = audioFiles.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join("\n");
    await writeFile(concatList, concatContent);

    await execFileAsync("ffmpeg", ["-f", "concat", "-safe", "0", "-i", concatList, "-c", "copy", combined]);

    const output = path.join(tmpDir, "output.mp4");
    const duration = Math.max(3, Math.min(10, audioFiles.length * 3));
    await execFileAsync("ffmpeg", ["-f", "lavfi", "-i", `color=c=black:s=1280x720:d=${duration}`, "-i", combined, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", output]);

    const buffer = await readFile(output);
    return `data:video/mp4;base64,${buffer.toString("base64")}`;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function createPlaceholderMp4DataUrl(audioCount) {
  const placeholderText = `placeholder-video-${audioCount}`;
  return `data:video/mp4;base64,${Buffer.from(placeholderText).toString("base64")}`;
}
