import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateRecipeScript, loadEnvFile } from "./openai-shorts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, ".env"));

const title = process.argv[2];
if (!title) {
  console.error('사용법: node generate-script.mjs "레시피명" "재료1,재료2" "과정1,과정2"');
  process.exit(1);
}

const recipe = {
  title,
  category: "간단한 간식",
  cookTime: 5,
  ingredients: String(process.argv[3] || "달걀 2개,밥 1공기").split(","),
  steps: String(process.argv[4] || "재료를 섞는다,전자레인지에 익힌다").split(","),
  hook: `5분이면 ${title} 완성!`,
  tip: "용기와 재료가 뜨거우니 조심하세요."
};

try {
  console.log(JSON.stringify(await generateRecipeScript({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || "gpt-5.4-nano", recipe, useAI: Boolean(process.env.OPENAI_API_KEY) }), null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
