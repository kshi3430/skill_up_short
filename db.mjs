import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_DATA = {
  recipes: [
    {
      id: "recipe-egg-rice",
      title: "폭신 계란밥",
      category: "계란 요리",
      difficulty: "매우 쉬움",
      cookTime: 5,
      cost: 2500,
      ingredients: ["달걀 2개", "밥 1공기", "간장 1큰술", "참기름 1작은술"],
      steps: ["달걀을 풀어 중불 팬에 붓는다", "젓가락으로 빠르게 저어 반숙으로 익힌다", "밥 위에 올리고 간장과 참기름을 두른다"],
      hook: "냉장고에 달걀만 있다면 5분이면 충분해요.",
      tip: "불을 끈 뒤에도 익으니 촉촉할 때 팬에서 내려주세요.",
      status: "published",
      views: 12840,
      createdAt: "2026-06-24T09:00:00.000Z",
      updatedAt: "2026-06-24T09:00:00.000Z"
    },
    {
      id: "recipe-kimchi-cup",
      title: "전자레인지 김치볶음밥",
      category: "전자레인지 요리",
      difficulty: "쉬움",
      cookTime: 4,
      cost: 3200,
      ingredients: ["밥 1공기", "김치 4큰술", "참치 1/2캔", "고추장 1/2큰술"],
      steps: ["전자레인지 용기에 모든 재료를 담는다", "골고루 섞고 뚜껑을 살짝 연다", "3분 30초 돌린 뒤 한 번 더 섞는다"],
      hook: "불도 팬도 필요 없는 김치볶음밥입니다.",
      tip: "김치 국물 한 숟갈을 넣으면 색과 감칠맛이 살아나요.",
      status: "ready",
      views: 0,
      createdAt: "2026-06-25T09:00:00.000Z",
      updatedAt: "2026-06-25T09:00:00.000Z"
    },
    {
      id: "recipe-ramen-toast",
      title: "바삭 라면땅",
      category: "간단한 간식",
      difficulty: "매우 쉬움",
      cookTime: 3,
      cost: 1200,
      ingredients: ["라면 사리 1개", "설탕 1큰술", "라면 수프 1/3봉"],
      steps: ["라면을 먹기 좋은 크기로 부순다", "접시에 펼쳐 전자레인지에 1분 30초 돌린다", "설탕과 수프를 뿌려 흔든다"],
      hook: "천 원짜리 라면 하나가 영화관 간식으로 바뀝니다.",
      tip: "30초 단위로 확인하면 타지 않고 고르게 바삭해져요.",
      status: "draft",
      views: 0,
      createdAt: "2026-06-26T09:00:00.000Z",
      updatedAt: "2026-06-26T09:00:00.000Z"
    }
  ],
  schedules: [
    { id: "schedule-1", recipeId: "recipe-egg-rice", publishAt: "2026-06-29T09:00:00+09:00", platform: "YouTube Shorts", status: "published" },
    { id: "schedule-2", recipeId: "recipe-kimchi-cup", publishAt: "2026-07-01T18:00:00+09:00", platform: "YouTube Shorts", status: "scheduled" },
    { id: "schedule-3", recipeId: "recipe-ramen-toast", publishAt: "2026-07-03T18:00:00+09:00", platform: "YouTube Shorts", status: "planned" }
  ]
};

export class JsonDatabase {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensure();
  }

  ensure() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) this.write(structuredClone(DEFAULT_DATA));
  }

  read() {
    return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
  }

  write(data) {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, this.filePath);
  }

  listRecipes({ query = "", category = "전체", status = "전체" } = {}) {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko");
    return this.read().recipes
      .filter((recipe) => category === "전체" || recipe.category === category)
      .filter((recipe) => status === "전체" || recipe.status === status)
      .filter((recipe) => {
        if (!normalizedQuery) return true;
        return [recipe.title, recipe.category, ...recipe.ingredients]
          .join(" ")
          .toLocaleLowerCase("ko")
          .includes(normalizedQuery);
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getRecipe(id) {
    return this.read().recipes.find((recipe) => recipe.id === id) || null;
  }

  createRecipe(input) {
    const data = this.read();
    const now = new Date().toISOString();
    const recipe = { id: randomUUID(), ...input, views: 0, createdAt: now, updatedAt: now };
    data.recipes.push(recipe);
    this.write(data);
    return recipe;
  }

  updateRecipe(id, input) {
    const data = this.read();
    const index = data.recipes.findIndex((recipe) => recipe.id === id);
    if (index === -1) return null;
    data.recipes[index] = { ...data.recipes[index], ...input, id, updatedAt: new Date().toISOString() };
    this.write(data);
    return data.recipes[index];
  }

  deleteRecipe(id) {
    const data = this.read();
    const before = data.recipes.length;
    data.recipes = data.recipes.filter((recipe) => recipe.id !== id);
    data.schedules = data.schedules.filter((schedule) => schedule.recipeId !== id);
    if (data.recipes.length === before) return false;
    this.write(data);
    return true;
  }

  listSchedules() {
    const data = this.read();
    return data.schedules
      .map((schedule) => ({ ...schedule, recipe: data.recipes.find((recipe) => recipe.id === schedule.recipeId) || null }))
      .sort((a, b) => a.publishAt.localeCompare(b.publishAt));
  }

  createSchedule(input) {
    const data = this.read();
    if (!data.recipes.some((recipe) => recipe.id === input.recipeId)) return null;
    const schedule = { id: randomUUID(), ...input };
    data.schedules.push(schedule);
    this.write(data);
    return { ...schedule, recipe: data.recipes.find((recipe) => recipe.id === input.recipeId) };
  }

  updateSchedule(id, input) {
    const data = this.read();
    const index = data.schedules.findIndex((schedule) => schedule.id === id);
    if (index === -1) return null;
    data.schedules[index] = { ...data.schedules[index], ...input, id };
    this.write(data);
    return data.schedules[index];
  }

  deleteSchedule(id) {
    const data = this.read();
    const before = data.schedules.length;
    data.schedules = data.schedules.filter((schedule) => schedule.id !== id);
    if (data.schedules.length === before) return false;
    this.write(data);
    return true;
  }

  dashboard() {
    const data = this.read();
    const published = data.recipes.filter((recipe) => recipe.status === "published");
    const totalViews = data.recipes.reduce((sum, recipe) => sum + Number(recipe.views || 0), 0);
    const upcoming = this.listSchedules().filter((item) => item.status !== "published").slice(0, 5);
    const categories = data.recipes.reduce((result, recipe) => {
      result[recipe.category] = (result[recipe.category] || 0) + 1;
      return result;
    }, {});
    return {
      stats: { totalRecipes: data.recipes.length, published: published.length, totalViews, weeklyGoal: 5, scheduled: upcoming.length },
      topRecipes: [...data.recipes].sort((a, b) => b.views - a.views).slice(0, 4),
      upcoming,
      categories
    };
  }
}

export function defaultData() {
  return structuredClone(DEFAULT_DATA);
}
