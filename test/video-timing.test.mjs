import test from "node:test";
import assert from "node:assert/strict";
import { calculateSceneDurations } from "../openai-video.mjs";

test("40초 장면 구간을 실제 TTS 길이에 비례해 배분한다", () => {
  const scenes = [
    { range: "0~3초" },
    { range: "3~8초" },
    { range: "8~30초" },
    { range: "30~40초" }
  ];

  assert.deepEqual(calculateSceneDurations(scenes, 20), [1.5, 2.5, 11, 5]);
});

test("잘못된 장면 구간에는 기본 40초 구성 비율을 사용한다", () => {
  assert.deepEqual(calculateSceneDurations([], 40), [3, 5, 22, 10]);
});
