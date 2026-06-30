const state = { recipes: [], schedules: [], dashboard: null, health: null, page: "dashboard", script: null, images: [], video: null };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const statusText = { draft: "아이디어", ready: "촬영 준비", published: "업로드 완료", planned: "기획 중", scheduled: "예약 완료" };
const number = new Intl.NumberFormat("ko-KR");
const dateLong = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short" });
const timeShort = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindNavigation();
  bindForms();
  $("#todayLabel").textContent = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  try {
    await refreshAll();
    const requested = location.hash.replace("#", "");
    showPage(["dashboard", "recipes", "calendar", "script"].includes(requested) ? requested : "dashboard");
  } catch (error) { toast(error.message, true); }
}

function bindNavigation() {
  $$("[data-page], [data-go]").forEach((button) => button.addEventListener("click", () => showPage(button.dataset.page || button.dataset.go)));
  $$('[data-open-recipe]').forEach((button) => button.addEventListener("click", () => openRecipeDialog()));
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  window.addEventListener("hashchange", () => { const page = location.hash.slice(1); if (page && page !== state.page) showPage(page, false); });
}

function bindForms() {
  $("#recipeSearch").addEventListener("input", debounce(loadRecipes, 250));
  $("#categoryFilter").addEventListener("change", loadRecipes);
  $("#statusFilter").addEventListener("change", loadRecipes);
  $("#recipeForm").addEventListener("submit", saveRecipe);
  $$('[data-close-dialog]').forEach((button) => button.addEventListener("click", () => $("#recipeDialog").close()));
  $("#openSchedule").addEventListener("click", openScheduleDialog);
  $$('[data-close-schedule]').forEach((button) => button.addEventListener("click", () => $("#scheduleDialog").close()));
  $("#scheduleForm").addEventListener("submit", saveSchedule);
  $("#scriptInputForm").addEventListener("submit", generateScript);
}

async function refreshAll() {
  const [dashboard, recipes, schedules, health] = await Promise.all([api("/api/dashboard"), api("/api/recipes"), api("/api/schedules"), api("/api/health")]);
  state.dashboard = dashboard; state.recipes = recipes; state.schedules = schedules; state.health = health;
  renderDashboard(); renderRecipes(); renderCalendar(); fillRecipeSelects();
}

async function loadRecipes() {
  const params = new URLSearchParams({ q: $("#recipeSearch").value, category: $("#categoryFilter").value, status: $("#statusFilter").value });
  state.recipes = await api(`/api/recipes?${params}`);
  renderRecipes();
}

function showPage(page, updateHash = true) {
  if (!["dashboard", "recipes", "calendar", "script"].includes(page)) return;
  state.page = page;
  $$(".page").forEach((section) => section.classList.toggle("active", section.id === `page-${page}`));
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  $("#sidebar").classList.remove("open");
  if (updateHash) history.replaceState(null, "", `#${page}`);
  $("#mainContent").focus({ preventScroll: true });
}

function renderDashboard() {
  const { stats, upcoming, topRecipes, categories } = state.dashboard;
  const weekPublished = state.schedules.filter((item) => item.status === "published").length;
  $("#goalCount").textContent = weekPublished;
  $("#goalProgress").style.width = `${Math.min(100, weekPublished / stats.weeklyGoal * 100)}%`;
  const cards = [
    ["전체 레시피", stats.totalRecipes, "개"], ["업로드 완료", stats.published, "편"],
    ["누적 조회수", compactNumber(stats.totalViews), "회"], ["예정 콘텐츠", stats.scheduled, "편"]
  ];
  $("#statsGrid").innerHTML = cards.map(([label, value, unit]) => `<article class="stat"><small>${label}</small><strong>${value}<span>${unit}</span></strong><i class="stat-line"></i></article>`).join("");
  $("#upcomingList").innerHTML = upcoming.length ? upcoming.map(scheduleRow).join("") : empty("예정된 업로드가 없어요", "새 일정을 추가해보세요.");
  const max = Math.max(1, ...Object.values(categories));
  $("#categoryChart").innerHTML = Object.entries(categories).map(([label, count]) => `<div class="category-row"><header><span>${escapeHtml(label)}</span><b>${count}개</b></header><div class="bar"><i style="width:${count / max * 100}%"></i></div></div>`).join("");
  $("#topRecipes").innerHTML = topRecipes.map((recipe, index) => `<article class="ranking-item"><span>0${index + 1}</span><h3>${escapeHtml(recipe.title)}</h3><p><span><svg><use href="#i-eye"/></svg>${number.format(recipe.views)}회</span><span><svg><use href="#i-clock"/></svg>${recipe.cookTime}분</span></p></article>`).join("");
}

function renderRecipes() {
  $("#recipeGrid").innerHTML = state.recipes.length ? state.recipes.map((recipe) => `
    <article class="recipe-card">
      <div class="recipe-stripe"></div><div class="recipe-body">
        <div class="recipe-meta"><span class="category">${escapeHtml(recipe.category)}</span><span class="status ${recipe.status}">${statusText[recipe.status]}</span></div>
        <h2>${escapeHtml(recipe.title)}</h2><p class="hook">${escapeHtml(recipe.hook)}</p>
        <div class="recipe-facts"><span><svg><use href="#i-clock"/></svg>${recipe.cookTime}분</span><span>${number.format(recipe.cost)}원</span><span>${escapeHtml(recipe.difficulty)}</span></div>
        <div class="recipe-actions"><button data-script="${recipe.id}"><svg><use href="#i-spark"/></svg>대본 만들기</button><button data-edit="${recipe.id}" aria-label="${escapeHtml(recipe.title)} 수정"><svg><use href="#i-edit"/></svg></button><button data-delete="${recipe.id}" aria-label="${escapeHtml(recipe.title)} 삭제"><svg><use href="#i-trash"/></svg></button></div>
      </div>
    </article>`).join("") : empty("검색 결과가 없어요", "필터를 바꾸거나 새 레시피를 등록해보세요.");
  $$('[data-edit]').forEach((button) => button.addEventListener("click", () => openRecipeDialog(state.recipes.find((item) => item.id === button.dataset.edit))));
  $$('[data-delete]').forEach((button) => button.addEventListener("click", () => deleteRecipe(button.dataset.delete)));
  $$('[data-script]').forEach((button) => button.addEventListener("click", () => {
    const recipe = state.recipes.find((item) => item.id === button.dataset.script);
    if (!recipe) return;
    fillScriptForm(recipe);
    showPage("script");
    toast("레시피 내용을 불러왔어요. 수정하거나 바로 대본을 만드세요.");
  }));
}

function renderCalendar() {
  const days = currentWeek();
  $("#weekStrip").innerHTML = days.map((date) => {
    const schedules = state.schedules.filter((item) => sameDay(new Date(item.publishAt), date));
    return `<article class="day ${sameDay(date, new Date()) ? "today" : ""}"><header><span>${"일월화수목금토"[date.getDay()]}</span><b>${date.getDate()}</b></header>${schedules.map((item) => `<div class="day-content">${escapeHtml(item.recipe?.title || "삭제된 레시피")}<small>${timeShort.format(new Date(item.publishAt))}</small></div>`).join("")}</article>`;
  }).join("");
  $("#calendarList").innerHTML = state.schedules.length ? state.schedules.map((item) => `<div class="calendar-item"><time>${dateLong.format(new Date(item.publishAt))} · ${timeShort.format(new Date(item.publishAt))}</time><strong>${escapeHtml(item.recipe?.title || "삭제된 레시피")}</strong><span class="platform">YouTube Shorts</span><span><span class="status ${item.status}">${statusText[item.status]}</span> <button data-delete-schedule="${item.id}" aria-label="일정 삭제"><svg><use href="#i-trash"/></svg></button></span></div>`).join("") : empty("아직 일정이 없어요", "주 5회 업로드 일정을 만들어보세요.");
  $$('[data-delete-schedule]').forEach((button) => button.addEventListener("click", () => deleteSchedule(button.dataset.deleteSchedule)));
}

function fillRecipeSelects() {
  const options = state.recipes.map((recipe) => `<option value="${recipe.id}">${escapeHtml(recipe.title)} · ${recipe.cookTime}분</option>`).join("");
  $("#scheduleRecipe").innerHTML = options || "<option>등록된 레시피 없음</option>";
}

function fillScriptForm(recipe) {
  const form = $("#scriptInputForm");
  form.elements.title.value = recipe.title || "";
}

function openRecipeDialog(recipe = null) {
  const form = $("#recipeForm"); form.reset(); form.elements.id.value = recipe?.id || "";
  $("#recipeDialogTitle").textContent = recipe ? "레시피 수정" : "새 레시피 등록";
  if (recipe) {
    for (const name of ["title", "category", "status", "cookTime", "cost", "difficulty", "hook", "tip"]) form.elements[name].value = recipe[name] ?? "";
    form.elements.ingredients.value = recipe.ingredients.join("\n"); form.elements.steps.value = recipe.steps.join("\n");
  } else { form.elements.cookTime.value = 5; form.elements.cost.value = 3000; }
  $("#recipeDialog").showModal();
}

async function saveRecipe(event) {
  event.preventDefault();
  const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const id = values.id;
  const payload = { ...values, cookTime: Number(values.cookTime), cost: Number(values.cost), ingredients: lines(values.ingredients), steps: lines(values.steps) };
  delete payload.id;
  try { await api(id ? `/api/recipes/${encodeURIComponent(id)}` : "/api/recipes", { method: id ? "PUT" : "POST", body: payload }); $("#recipeDialog").close(); await refreshAll(); toast(id ? "레시피를 수정했어요." : "새 레시피를 저장했어요."); } catch (error) { toast(error.message, true); }
}

async function deleteRecipe(id) {
  const recipe = state.recipes.find((item) => item.id === id);
  if (!confirm(`'${recipe?.title || "이 레시피"}'을 삭제할까요? 연결된 일정도 함께 삭제됩니다.`)) return;
  try { await api(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }); await refreshAll(); toast("레시피를 삭제했어요."); } catch (error) { toast(error.message, true); }
}

function openScheduleDialog() {
  if (!state.recipes.length) return toast("먼저 레시피를 등록해주세요.", true);
  const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(18, 0, 0, 0);
  $("#scheduleForm").reset(); $("#scheduleForm").elements.publishAt.value = localInputValue(date); $("#scheduleDialog").showModal();
}

async function saveSchedule(event) {
  event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
  try { await api("/api/schedules", { method: "POST", body: values }); $("#scheduleDialog").close(); await refreshAll(); toast("업로드 일정을 추가했어요."); } catch (error) { toast(error.message, true); }
}

async function deleteSchedule(id) {
  if (!confirm("이 업로드 일정을 삭제할까요?")) return;
  try { await api(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }); await refreshAll(); toast("일정을 삭제했어요."); } catch (error) { toast(error.message, true); }
}

async function generateScript(event) {
  event?.preventDefault();
  const values = Object.fromEntries(new FormData($("#scriptInputForm")));
  const button = $("#generateScript"); button.disabled = true; button.textContent = "대본 구성 중...";
  try { state.script = await api("/api/generate-script", { method: "POST", body: { title: values.title } }); state.images = []; renderScript(); toast(["ai", "gemini"].includes(state.script.source) ? "AI가 레시피와 대본을 만들었어요." : "레시피와 촬영 대본을 만들었어요."); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; button.innerHTML = '<svg><use href="#i-spark"/></svg>40초 대본 생성'; }
}

function renderScript() {
  const script = state.script;
  const sourceText = script.source === "gemini" ? "Gemini 초안" : script.source === "ai" ? "OpenAI 초안" : "자동 구성";
  $("#scriptResult").innerHTML = `<article class="script-sheet"><header><div><p>YOUTUBE SHORTS · ${script.duration} SEC</p><h2>${escapeHtml(script.title)}</h2><p>썸네일: ${escapeHtml(script.thumbnail)} · ${sourceText}</p></div><div class="script-actions"><button class="secondary" id="copyScript">대본 복사</button><button class="primary" id="generateImages" ${state.health?.imageEnabled ? "" : "disabled"}>장면 이미지 4장 생성</button><button class="secondary" id="generateVideo" ${state.images.length === 4 ? "" : "disabled"}>영상 만들기</button></div></header>${script.scenes.map((scene, index) => `<section class="script-scene"><div class="scene-time"><b>${escapeHtml(scene.range)}</b><span>${escapeHtml(scene.label)}</span></div><div><h3>내레이션 / 자막</h3><p>${escapeHtml(scene.narration)}</p></div><div>${state.images[index] ? `<img class="scene-image" src="${state.images[index].imageDataUrl}" alt="${escapeHtml(scene.label)} 장면 이미지" />` : ""}<h3>촬영 화면</h3><p>${escapeHtml(scene.visual)}</p></div></section>`).join("")}<div class="hashtags">${script.hashtags.map(escapeHtml).join(" ")}</div>${state.video ? `<div class="video-preview"><video controls src="${state.video.videoDataUrl}"></video></div>` : ""}</article>`;
  $("#copyScript").addEventListener("click", copyScript);
  $("#generateImages").addEventListener("click", generateImages);
  $("#generateVideo").addEventListener("click", generateVideo);
}

async function generateImages() {
  if (!state.health?.imageEnabled) return toast(".env에 STABILITY_API_KEY를 입력하고 서버를 다시 시작해주세요.", true);
  const button = $("#generateImages");
  button.disabled = true; button.textContent = "이미지 생성 중...";
  try {
    const result = await api("/api/generate-images", { method: "POST", body: { scenes: state.script.scenes } });
    state.images = result.images;
    renderScript();
    toast("9:16 장면 이미지 4장을 만들었어요.");
  } catch (error) {
    button.disabled = false; button.textContent = "장면 이미지 4장 생성";
    toast(error.message, true);
  }
}

async function generateVideo() {
  if (!state.images.length) return toast("먼저 이미지 4장을 생성해주세요.", true);
  const button = $("#generateVideo");
  button.disabled = true; button.textContent = "영상 생성 중...";
  try {
    const result = await api("/api/generate-video", { method: "POST", body: { scenes: state.script.scenes, images: state.images } });
    state.video = result;
    renderScript();
    toast("영상 파일을 만들었어요.");
  } catch (error) {
    button.disabled = false; button.textContent = "영상 만들기";
    toast(error.message, true);
  }
}

async function copyScript() {
  const text = `${state.script.title}\n\n${state.script.scenes.map((scene) => `[${scene.range} ${scene.label}]\n${scene.narration}\n촬영: ${scene.visual}`).join("\n\n")}\n\n${state.script.hashtags.join(" ")}`;
  await navigator.clipboard.writeText(text); toast("대본을 클립보드에 복사했어요.");
}

function scheduleRow(item) { const date = new Date(item.publishAt); return `<article class="schedule-row"><div class="date-tile"><b>${date.getDate()}</b><span>${date.toLocaleDateString("ko-KR", { weekday: "short" })}</span></div><div><h3>${escapeHtml(item.recipe?.title || "삭제된 레시피")}</h3><p>${timeShort.format(date)} · ${escapeHtml(item.platform)}</p></div><span class="status ${item.status}">${statusText[item.status]}</span></article>`; }
function currentWeek() { const now = new Date(); const start = new Date(now); start.setHours(0,0,0,0); start.setDate(now.getDate() - now.getDay()); return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; }); }
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function localInputValue(date) { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60000).toISOString().slice(0,16); }
function compactNumber(value) { if (value >= 10000) return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}만`; return number.format(value); }
function lines(value) { return String(value).split("\n").map((line) => line.trim()).filter(Boolean); }
function empty(title, body) { return `<div class="empty-list"><strong>${escapeHtml(title)}</strong>${escapeHtml(body)}</div>`; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function debounce(fn, delay) { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); }; }
let toastTimer;
function toast(message, isError = false) { const element = $("#toast"); element.textContent = message; element.style.background = isError ? "#922f22" : "#1f2923"; element.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove("show"), 2500); }

async function api(url, options = {}) {
  const response = await fetch(url, { method: options.method || "GET", headers: options.body ? { "Content-Type": "application/json" } : {}, body: options.body ? JSON.stringify(options.body) : undefined });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
