import { generateVideoWithJson2Video } from "./json2video.mjs";

const testScenes = [
  { text: "맛있는 요리", narration: "오늘은 맛있는 음식을 만들어봅시다" },
  { text: "음식 준비", narration: "먼저 재료를 준비합니다" },
];

const testImages = [
  "https://via.placeholder.com/300",
  "https://via.placeholder.com/300",
];

try {
  console.log("영상 생성 테스트 시작...");
  const result = await generateVideoWithJson2Video({
    scenes: testScenes,
    images: testImages,
  });
  console.log("성공:", JSON.stringify(result, null, 2));
} catch (error) {
  console.error("오류 발생:", error.message);
  console.error("스택:", error.stack);
}
