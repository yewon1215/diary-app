/* Diary app (no build step) */

const STORAGE_KEYS = Object.freeze({
  entries: "diary.entries.v1",
  settings: "diary.settings.v1",
  draft: "diary.draft.v1",
  weather: "diary.weather.v1",
});

function getAppConfig() {
  const cfg = globalThis.__APP_CONFIG__;
  if (!cfg || typeof cfg !== "object") {
    throw new Error("설정이 없습니다. server.py로 실행 중인지 확인해 주세요.");
  }
  const url = typeof cfg.SUPABASE_URL === "string" ? cfg.SUPABASE_URL.trim() : "";
  const anonKey = typeof cfg.SUPABASE_ANON_KEY === "string" ? cfg.SUPABASE_ANON_KEY.trim() : "";
  if (!url || !anonKey) {
    throw new Error("Supabase 설정이 비어있습니다. .env를 채워주세요.");
  }
  return { url, anonKey, table: "entries" };
}

function todayISODate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeParseJSON(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function clampString(s, max) {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeTags(s) {
  if (typeof s !== "string") return [];
  const parts = s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const t of parts) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(t);
  }
  return uniq.slice(0, 16);
}

function formatKoreanDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map((x) => Number(x));
  if (!y || !m || !d) return iso;
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")}`;
}

function makePreview(text) {
  const s = (text || "").replace(/\s+/g, " ").trim();
  return s.length > 180 ? `${s.slice(0, 180)}…` : s;
}

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

let _supabaseClient = null;
function getSupabaseClient() {
  const lib = globalThis.supabase;
  if (!lib?.createClient) throw new Error("Supabase 라이브러리를 불러오지 못했습니다.");
  if (_supabaseClient) return _supabaseClient;
  const cfg = getAppConfig();
  _supabaseClient = lib.createClient(cfg.url, cfg.anonKey);
  return _supabaseClient;
}

function entryToDBContent(entry) {
  // DB 스키마가 id/created_at/content 뿐이라, content에 전체 엔트리를 JSON으로 저장
  return JSON.stringify({
    clientId: entry.id,
    title: entry.title || "",
    content: entry.content || "",
    date: entry.date || todayISODate(),
    mood: entry.mood || "🙂",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    pinned: Boolean(entry.pinned),
    createdAt: typeof entry.createdAt === "number" ? entry.createdAt : Date.now(),
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
    _schema: "diary.entry.v1",
  });
}

function dbRowToEntry(row) {
  const dbId = typeof row?.id === "number" ? row.id : Number(row?.id);
  const createdAt = row?.created_at ? Date.parse(row.created_at) : Date.now();
  const raw = typeof row?.content === "string" ? row.content : "";
  const parsed = safeParseJSON(raw, null);

  if (parsed && typeof parsed === "object") {
    const clientId = typeof parsed?.clientId === "string" ? parsed.clientId : typeof parsed?.id === "string" ? parsed.id : uuid();
    return {
      id: clientId,
      dbId: Number.isFinite(dbId) ? dbId : null,
      title: clampString(parsed?.title || "", 80),
      content: clampString(parsed?.content || "", 8000),
      date: typeof parsed?.date === "string" ? parsed.date : todayISODate(),
      mood: typeof parsed?.mood === "string" ? parsed.mood : "🙂",
      tags: Array.isArray(parsed?.tags) ? parsed.tags.filter((t) => typeof t === "string").slice(0, 16) : [],
      pinned: Boolean(parsed?.pinned),
      createdAt: Number.isFinite(parsed?.createdAt) ? parsed.createdAt : createdAt,
      updatedAt: Number.isFinite(parsed?.updatedAt) ? parsed.updatedAt : createdAt,
    };
  }

  // fallback: content에 평문만 들어있는 경우
  return {
    id: uuid(),
    dbId: Number.isFinite(dbId) ? dbId : null,
    title: "",
    content: clampString(raw || "", 8000),
    date: todayISODate(),
    mood: "🙂",
    tags: [],
    pinned: false,
    createdAt,
    updatedAt: createdAt,
  };
}

async function supabaseLoadEntries() {
  const client = getSupabaseClient();
  const cfg = getAppConfig();
  const { data, error } = await client
    .from(cfg.table)
    .select("id, created_at, content")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(dbRowToEntry);
}

async function supabaseInsertEntry(entry) {
  const client = getSupabaseClient();
  const cfg = getAppConfig();
  const payload = { content: entryToDBContent(entry) };
  const { data, error } = await client
    .from(cfg.table)
    .insert(payload)
    .select("id, created_at")
    .single();
  if (error) throw error;
  return data;
}

async function supabaseUpdateEntry(entry) {
  if (!entry?.dbId) throw new Error("dbId가 없어 Supabase 업데이트를 할 수 없습니다.");
  const client = getSupabaseClient();
  const cfg = getAppConfig();
  const payload = { content: entryToDBContent(entry) };
  const { error } = await client.from(cfg.table).update(payload).eq("id", entry.dbId);
  if (error) throw error;
}

async function supabaseDeleteEntry(dbId) {
  if (!dbId) throw new Error("dbId가 없어 Supabase 삭제를 할 수 없습니다.");
  const client = getSupabaseClient();
  const cfg = getAppConfig();
  const { error } = await client.from(cfg.table).delete().eq("id", dbId);
  if (error) throw error;
}

function loadEntries() {
  const raw = localStorage.getItem(STORAGE_KEYS.entries);
  const parsed = safeParseJSON(raw || "[]", []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((e) => ({
      id: typeof e?.id === "string" ? e.id : uuid(),
      title: clampString(e?.title || "", 80),
      content: clampString(e?.content || "", 8000),
      date: typeof e?.date === "string" ? e.date : todayISODate(),
      mood: typeof e?.mood === "string" ? e.mood : "🙂",
      tags: Array.isArray(e?.tags) ? e.tags.filter((t) => typeof t === "string").slice(0, 16) : [],
      pinned: Boolean(e?.pinned),
      createdAt: typeof e?.createdAt === "number" ? e.createdAt : Date.now(),
      updatedAt: typeof e?.updatedAt === "number" ? e.updatedAt : Date.now(),
    }))
    .filter((e) => e.id);
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(entries));
}

function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEYS.settings);
  const s = safeParseJSON(raw || "{}", {});
  return {
    theme: s?.theme === "light" || s?.theme === "dark" ? s.theme : "system",
    sort: typeof s?.sort === "string" ? s.sort : "pinned_desc_date_desc",
    search: typeof s?.search === "string" ? s.search : "",
  };
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings));
}

function loadDraft() {
  const raw = localStorage.getItem(STORAGE_KEYS.draft);
  const d = safeParseJSON(raw || "null", null);
  if (!d || typeof d !== "object") return null;
  return {
    title: clampString(d?.title || "", 80),
    content: clampString(d?.content || "", 8000),
    date: typeof d?.date === "string" ? d.date : todayISODate(),
    mood: typeof d?.mood === "string" ? d.mood : "🙂",
    tagsText: clampString(d?.tagsText || "", 240),
    updatedAt: typeof d?.updatedAt === "number" ? d.updatedAt : Date.now(),
  };
}

function saveDraft(draft) {
  localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(draft));
}

function clearDraft() {
  localStorage.removeItem(STORAGE_KEYS.draft);
}

function toast(message) {
  const host = $("#toastHost");
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  host.appendChild(el);
  const t = setTimeout(() => {
    el.remove();
    clearTimeout(t);
  }, 2400);
}

function $(sel) {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`Missing element: ${sel}`);
  return el;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function weatherCodeToKorean(code) {
  const c = Number(code);
  if (Number.isNaN(c)) return "날씨";
  if (c === 0) return "맑음";
  if (c === 1) return "대체로 맑음";
  if (c === 2) return "부분적으로 흐림";
  if (c === 3) return "흐림";
  if (c === 45 || c === 48) return "안개";
  if (c === 51 || c === 53 || c === 55) return "이슬비";
  if (c === 56 || c === 57) return "얼어붙는 이슬비";
  if (c === 61 || c === 63 || c === 65) return "비";
  if (c === 66 || c === 67) return "얼어붙는 비";
  if (c === 71 || c === 73 || c === 75) return "눈";
  if (c === 77) return "싸락눈";
  if (c === 80 || c === 81 || c === 82) return "소나기";
  if (c === 85 || c === 86) return "눈 소나기";
  if (c === 95) return "뇌우";
  if (c === 96 || c === 99) return "우박/강한 뇌우";
  return "날씨";
}

function weatherCodeToEmoji(code) {
  const c = Number(code);
  if (Number.isNaN(c)) return "🌤️";
  if (c === 0) return "☀️";
  if (c === 1) return "🌤️";
  if (c === 2) return "⛅";
  if (c === 3) return "☁️";
  if (c === 45 || c === 48) return "🌫️";
  if (c === 51 || c === 53 || c === 55 || c === 56 || c === 57) return "🌦️";
  if (c === 61 || c === 63 || c === 65 || c === 66 || c === 67 || c === 80 || c === 81 || c === 82) return "🌧️";
  if (c === 71 || c === 73 || c === 75 || c === 77 || c === 85 || c === 86) return "🌨️";
  if (c === 95 || c === 96 || c === 99) return "⛈️";
  return "🌤️";
}

function loadWeatherCache() {
  const raw = localStorage.getItem(STORAGE_KEYS.weather);
  const w = safeParseJSON(raw || "null", null);
  if (!w || typeof w !== "object") return null;
  return {
    fetchedAt: typeof w?.fetchedAt === "number" ? w.fetchedAt : 0,
    latitude: typeof w?.latitude === "number" ? w.latitude : null,
    longitude: typeof w?.longitude === "number" ? w.longitude : null,
    locationName: typeof w?.locationName === "string" ? w.locationName : "",
    temperatureC: typeof w?.temperatureC === "number" ? w.temperatureC : null,
    windKmh: typeof w?.windKmh === "number" ? w.windKmh : null,
    weatherCode: typeof w?.weatherCode === "number" ? w.weatherCode : null,
  };
}

function saveWeatherCache(cache) {
  localStorage.setItem(STORAGE_KEYS.weather, JSON.stringify(cache));
}

async function fetchJSON(url, { timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

async function reverseGeocodeOpenMeteo({ latitude, longitude }) {
  const url =
    "https://geocoding-api.open-meteo.com/v1/reverse" +
    `?latitude=${encodeURIComponent(latitude)}` +
    `&longitude=${encodeURIComponent(longitude)}` +
    "&language=ko" +
    "&format=json";
  const json = await fetchJSON(url);
  const r0 = Array.isArray(json?.results) ? json.results[0] : null;
  const nameParts = [
    r0?.name,
    r0?.admin1, // 도/주
    r0?.country,
  ].filter((x) => typeof x === "string" && x.trim());
  return nameParts.length ? nameParts[0] : "";
}

async function fetchCurrentWeatherOpenMeteo({ latitude, longitude }) {
  const url =
    "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${encodeURIComponent(latitude)}` +
    `&longitude=${encodeURIComponent(longitude)}` +
    "&current=temperature_2m,weather_code,wind_speed_10m" +
    "&timezone=auto";
  const json = await fetchJSON(url);
  const cur = json?.current;
  return {
    temperatureC: typeof cur?.temperature_2m === "number" ? cur.temperature_2m : null,
    windKmh: typeof cur?.wind_speed_10m === "number" ? cur.wind_speed_10m : null,
    weatherCode: typeof cur?.weather_code === "number" ? cur.weather_code : null,
  };
}

async function confirmDialog({ title, desc, okText = "확인", danger = true }) {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmDesc").textContent = desc;
  const okBtn = $("#confirmOk");
  okBtn.textContent = okText;
  okBtn.className = danger ? "btn btn--danger" : "btn btn--primary";

  if (typeof dialog.showModal === "function") dialog.showModal();
  else return window.confirm(`${title}\n\n${desc}`) ? "ok" : "cancel";

  return await new Promise((resolve) => {
    dialog.addEventListener(
      "close",
      () => {
        resolve(dialog.returnValue || "cancel");
      },
      { once: true },
    );
  });
}

function applyTheme(theme) {
  const root = document.documentElement;
  const btn = $("#themeToggle");
  const systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  if (effective === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");

  const label = theme === "system" ? "시스템" : theme === "dark" ? "다크" : "라이트";
  btn.setAttribute("aria-pressed", effective === "dark" ? "true" : "false");
  btn.querySelector(".btn__label").textContent = `테마: ${label}`;
}

function sortEntries(entries, sortKey) {
  const list = [...entries];
  const byDateDesc = (a, b) => (b.date || "").localeCompare(a.date || "");
  const byDateAsc = (a, b) => (a.date || "").localeCompare(b.date || "");
  const byUpdatedDesc = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const byPinnedDesc = (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));

  if (sortKey === "date_desc") list.sort(byDateDesc);
  else if (sortKey === "date_asc") list.sort(byDateAsc);
  else if (sortKey === "updated_desc") list.sort(byUpdatedDesc);
  else list.sort((a, b) => byPinnedDesc(a, b) || byDateDesc(a, b) || byUpdatedDesc(a, b));
  return list;
}

function matchesSearch(entry, q) {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const hay = `${entry.title}\n${entry.content}\n${(entry.tags || []).join(",")}`.toLowerCase();
  return hay.includes(needle);
}

function buildCard(entry) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card";
  card.setAttribute("role", "listitem");
  card.dataset.id = entry.id;

  const top = document.createElement("div");
  top.className = "card__top";

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = entry.title || "(제목 없음)";

  const date = document.createElement("div");
  date.className = "card__date";
  date.textContent = formatKoreanDate(entry.date);

  top.appendChild(title);
  top.appendChild(date);

  const preview = document.createElement("div");
  preview.className = "card__preview";
  preview.textContent = makePreview(entry.content);

  const chips = document.createElement("div");
  chips.className = "chips";

  const mood = document.createElement("span");
  mood.className = "chip";
  mood.textContent = entry.mood || "🙂";
  chips.appendChild(mood);

  if (entry.pinned) {
    const pin = document.createElement("span");
    pin.className = "chip chip--pin";
    pin.textContent = "★ 즐겨찾기";
    chips.appendChild(pin);
  }

  for (const t of (entry.tags || []).slice(0, 6)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `#${t}`;
    chips.appendChild(chip);
  }

  card.appendChild(top);
  card.appendChild(preview);
  card.appendChild(chips);
  return card;
}

function exportJSON(entries) {
  const payload = {
    schema: "diary.export.v1",
    exportedAt: new Date().toISOString(),
    entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date();
  const y = stamp.getFullYear();
  const m = String(stamp.getMonth() + 1).padStart(2, "0");
  const d = String(stamp.getDate()).padStart(2, "0");
  a.href = url;
  a.download = `diary_${y}${m}${d}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJSON(file) {
  const text = await file.text();
  const payload = safeParseJSON(text, null);
  if (!payload || typeof payload !== "object") throw new Error("JSON 형식이 올바르지 않습니다.");
  const entries = Array.isArray(payload.entries) ? payload.entries : Array.isArray(payload) ? payload : null;
  if (!entries) throw new Error("가져올 데이터(entries)를 찾지 못했습니다.");
  const cleaned = entries
    .filter(Boolean)
    .map((e) => ({
      id: typeof e?.id === "string" ? e.id : uuid(),
      title: clampString(e?.title || "", 80),
      content: clampString(e?.content || "", 8000),
      date: typeof e?.date === "string" ? e.date : todayISODate(),
      mood: typeof e?.mood === "string" ? e.mood : "🙂",
      tags: Array.isArray(e?.tags) ? e.tags.filter((t) => typeof t === "string").slice(0, 16) : [],
      pinned: Boolean(e?.pinned),
      createdAt: typeof e?.createdAt === "number" ? e.createdAt : Date.now(),
      updatedAt: typeof e?.updatedAt === "number" ? e.updatedAt : Date.now(),
    }));
  return cleaned;
}

function main() {
  const els = {
    themeToggle: $("#themeToggle"),
    exportBtn: $("#exportBtn"),
    importInput: $("#importInput"),
    weatherText: $("#weatherText"),
    weatherRefresh: $("#weatherRefresh"),
    entryForm: $("#entryForm"),
    titleInput: $("#titleInput"),
    dateInput: $("#dateInput"),
    contentInput: $("#contentInput"),
    moodInput: $("#moodInput"),
    tagsInput: $("#tagsInput"),
    saveBtn: $("#saveBtn"),
    resetBtn: $("#resetBtn"),
    deleteBtn: $("#deleteBtn"),
    newBtn: $("#newBtn"),
    searchInput: $("#searchInput"),
    sortSelect: $("#sortSelect"),
    list: $("#list"),
    emptyState: $("#emptyState"),
    countLabel: $("#countLabel"),
    charCount: $("#charCount"),
    draftStatus: $("#draftStatus"),
  };

  // entries: Supabase가 기본 소스, 로컬스토리지는 빠른 초기 표시/오프라인 캐시로 사용
  let entries = loadEntries();
  let settings = loadSettings();
  let selectedId = null;

  // weather (no API key, Open-Meteo)
  const WEATHER_TTL_MS = 20 * 60 * 1000;
  const DEFAULT_COORDS = { latitude: 37.5665, longitude: 126.978 }; // Seoul
  let weatherLoading = false;

  function renderWeather(cache) {
    if (!cache) {
      els.weatherText.textContent = "날씨 정보를 불러오지 못했어요";
      return;
    }
    const place = cache.locationName ? `${cache.locationName} · ` : "";
    const emoji = weatherCodeToEmoji(cache.weatherCode);
    const label = weatherCodeToKorean(cache.weatherCode);
    const temp = typeof cache.temperatureC === "number" ? `${Math.round(cache.temperatureC)}°C` : "";
    const wind = typeof cache.windKmh === "number" ? `바람 ${Math.round(cache.windKmh)}km/h` : "";
    const parts = [`${emoji} ${place}${label}`.trim(), temp, wind].filter(Boolean);
    els.weatherText.textContent = parts.join(" · ");
  }

  async function getCoords() {
    if (!navigator.geolocation) return { ...DEFAULT_COORDS, source: "default" };
    const p = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, source: "geo" }),
        () => resolve({ ...DEFAULT_COORDS, source: "default" }),
        { enableHighAccuracy: false, timeout: 4500, maximumAge: 60 * 60 * 1000 },
      );
    });
    return await p;
  }

  async function refreshWeather({ force = false } = {}) {
    if (weatherLoading) return;
    weatherLoading = true;
    try {
      const cached = loadWeatherCache();
      const now = Date.now();
      if (!force && cached && now - cached.fetchedAt < WEATHER_TTL_MS) {
        renderWeather(cached);
        return;
      }

      els.weatherText.textContent = "날씨 불러오는 중…";
      const coords = await getCoords();
      const [wx, place] = await Promise.all([
        fetchCurrentWeatherOpenMeteo(coords),
        reverseGeocodeOpenMeteo(coords).catch(() => ""),
      ]);

      const merged = {
        fetchedAt: now,
        latitude: coords.latitude,
        longitude: coords.longitude,
        locationName: place || (coords.source === "default" ? "서울" : ""),
        temperatureC: wx.temperatureC,
        windKmh: wx.windKmh,
        weatherCode: wx.weatherCode,
      };
      saveWeatherCache(merged);
      renderWeather(merged);
    } catch {
      const cached = loadWeatherCache();
      renderWeather(cached);
    } finally {
      weatherLoading = false;
    }
  }

  // initial render + refresh button
  renderWeather(loadWeatherCache());
  refreshWeather({ force: false });
  els.weatherRefresh.addEventListener("click", () => refreshWeather({ force: true }));

  // theme
  applyTheme(settings.theme);
  els.themeToggle.addEventListener("click", () => {
    const next = settings.theme === "system" ? "dark" : settings.theme === "dark" ? "light" : "system";
    settings = { ...settings, theme: next };
    saveSettings(settings);
    applyTheme(settings.theme);
    toast(`테마: ${next === "system" ? "시스템" : next === "dark" ? "다크" : "라이트"}`);
  });

  // restore sort/search
  els.sortSelect.value = settings.sort;
  els.searchInput.value = settings.search;

  function setDraftStatus(text) {
    els.draftStatus.textContent = text || "";
  }

  function setComposeMode(mode) {
    // mode: "new" | "edit"
    if (mode === "edit") {
      els.deleteBtn.hidden = false;
      els.saveBtn.textContent = "수정 저장";
    } else {
      els.deleteBtn.hidden = true;
      els.saveBtn.textContent = "저장";
    }
  }

  function resetForm({ keepDraft = false } = {}) {
    selectedId = null;
    setComposeMode("new");
    els.titleInput.value = "";
    els.contentInput.value = "";
    els.tagsInput.value = "";
    els.moodInput.value = "🙂";
    els.dateInput.value = todayISODate();
    els.charCount.textContent = "0";
    setDraftStatus("");
    if (!keepDraft) clearDraft();
  }

  function fillForm(entry) {
    selectedId = entry.id;
    setComposeMode("edit");
    els.titleInput.value = entry.title || "";
    els.contentInput.value = entry.content || "";
    els.tagsInput.value = (entry.tags || []).join(", ");
    els.moodInput.value = entry.mood || "🙂";
    els.dateInput.value = entry.date || todayISODate();
    els.charCount.textContent = String((entry.content || "").length);
    setDraftStatus("편집 중");
  }

  function renderList() {
    const q = els.searchInput.value;
    const filtered = entries.filter((e) => matchesSearch(e, q));
    const sorted = sortEntries(filtered, els.sortSelect.value);

    els.list.innerHTML = "";
    for (const e of sorted) {
      const card = buildCard(e);
      card.addEventListener("click", () => {
        const target = entries.find((x) => x.id === e.id);
        if (!target) return;
        fillForm(target);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
      card.addEventListener("contextmenu", async (ev) => {
        ev.preventDefault();
        const target = entries.find((x) => x.id === e.id);
        if (!target) return;
        target.pinned = !target.pinned;
        target.updatedAt = Date.now();
        saveEntries(entries);
        renderList();
        toast(target.pinned ? "즐겨찾기 추가" : "즐겨찾기 해제");
      });
      els.list.appendChild(card);
    }

    const total = entries.length;
    const shown = filtered.length;
    els.countLabel.textContent = q ? `${shown}/${total}개` : `${total}개`;
    els.emptyState.hidden = total !== 0;
  }

  // init date
  els.dateInput.value = todayISODate();

  // draft restore
  const draft = loadDraft();
  if (draft && (draft.title || draft.content || draft.tagsText)) {
    els.titleInput.value = draft.title;
    els.contentInput.value = draft.content;
    els.tagsInput.value = draft.tagsText;
    els.moodInput.value = draft.mood;
    els.dateInput.value = draft.date;
    els.charCount.textContent = String((draft.content || "").length);
    setDraftStatus("임시저장 복원됨");
  }

  const persistDraft = debounce(() => {
    if (selectedId) return; // editing existing entry: no draft
    const snapshot = {
      title: clampString(els.titleInput.value, 80),
      content: clampString(els.contentInput.value, 8000),
      date: els.dateInput.value || todayISODate(),
      mood: els.moodInput.value || "🙂",
      tagsText: clampString(els.tagsInput.value, 240),
      updatedAt: Date.now(),
    };
    const hasSomething = Boolean(snapshot.title || snapshot.content || snapshot.tagsText);
    if (hasSomething) {
      saveDraft(snapshot);
      setDraftStatus("임시저장됨");
    } else {
      clearDraft();
      setDraftStatus("");
    }
  }, 300);

  // character count + draft
  els.contentInput.addEventListener("input", () => {
    els.charCount.textContent = String(els.contentInput.value.length);
  });
  for (const el of [els.titleInput, els.contentInput, els.tagsInput, els.dateInput, els.moodInput]) {
    el.addEventListener("input", persistDraft);
    el.addEventListener("change", persistDraft);
  }

  // save entry
  els.entryForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const title = clampString(els.titleInput.value.trim(), 80);
    const content = clampString(els.contentInput.value.trim(), 8000);
    const date = els.dateInput.value || todayISODate();
    const mood = els.moodInput.value || "🙂";
    const tags = normalizeTags(els.tagsInput.value);
    const now = Date.now();

    if (!content && !title) {
      toast("제목 또는 내용을 입력해 주세요.");
      els.contentInput.focus();
      return;
    }

    if (selectedId) {
      const idx = entries.findIndex((e) => e.id === selectedId);
      if (idx === -1) {
        toast("편집 대상이 사라졌어요. 새로 저장합니다.");
        selectedId = null;
      } else {
        const updated = {
          ...entries[idx],
          title,
          content,
          date,
          mood,
          tags,
          updatedAt: now,
        };
        entries[idx] = updated;
        saveEntries(entries);
        renderList();
        toast("수정 저장됨");
        try {
          await supabaseUpdateEntry(updated);
          toast("Supabase 수정 완료");
        } catch (e) {
          console.warn(e);
          toast(updated.dbId ? "Supabase 수정 실패 (로컬에는 저장됨)" : "Supabase id가 없어 수정 동기화 불가");
        }
        return;
      }
    }

    const entry = {
      id: uuid(),
      dbId: null,
      title,
      content,
      date,
      mood,
      tags,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    entries = [entry, ...entries];
    saveEntries(entries);
    clearDraft();
    toast("저장됨");
    resetForm({ keepDraft: true });
    renderList();
    try {
      const inserted = await supabaseInsertEntry(entry);
      const dbId = typeof inserted?.id === "number" ? inserted.id : Number(inserted?.id);
      const createdAtIso = typeof inserted?.created_at === "string" ? inserted.created_at : null;
      const createdAtMs = createdAtIso ? Date.parse(createdAtIso) : null;
      if (Number.isFinite(dbId)) {
        entry.dbId = dbId;
        if (Number.isFinite(createdAtMs)) entry.createdAt = createdAtMs;
        entry.updatedAt = Date.now();
        saveEntries(entries);
        renderList();
      }
      toast("Supabase 저장 완료");
    } catch (e) {
      console.warn(e);
      toast("Supabase 저장 실패 (로컬에는 저장됨)");
    }
  });

  // reset/new
  els.resetBtn.addEventListener("click", async () => {
    const hasText = Boolean(els.titleInput.value || els.contentInput.value || els.tagsInput.value);
    if (selectedId || hasText) {
      const res = await confirmDialog({
        title: "초기화할까요?",
        desc: selectedId ? "현재 편집 중인 내용이 사라집니다." : "작성 중인 내용이 사라집니다.",
        okText: "초기화",
      });
      if (res !== "ok") return;
    }
    resetForm();
    toast("초기화됨");
  });

  els.newBtn.addEventListener("click", () => {
    resetForm();
    els.titleInput.focus();
  });

  // delete
  els.deleteBtn.addEventListener("click", async () => {
    if (!selectedId) return;
    const target = entries.find((e) => e.id === selectedId);
    if (!target) return;
    const res = await confirmDialog({
      title: "삭제할까요?",
      desc: `“${target.title || "제목 없음"}” 일기를 삭제합니다.`,
      okText: "삭제",
    });
    if (res !== "ok") return;
    entries = entries.filter((e) => e.id !== selectedId);
    saveEntries(entries);
    resetForm();
    renderList();
    toast("삭제됨");
    try {
      await supabaseDeleteEntry(target.dbId);
      toast("Supabase 삭제 완료");
    } catch (e) {
      console.warn(e);
      toast("Supabase 삭제 실패 (로컬에서는 삭제됨)");
    }
  });

  // search/sort persist
  els.searchInput.addEventListener(
    "input",
    debounce(() => {
      settings = { ...settings, search: els.searchInput.value };
      saveSettings(settings);
      renderList();
    }, 120),
  );
  els.sortSelect.addEventListener("change", () => {
    settings = { ...settings, sort: els.sortSelect.value };
    saveSettings(settings);
    renderList();
  });

  // export/import
  els.exportBtn.addEventListener("click", () => {
    exportJSON(entries);
    toast("내보내기 준비됨");
  });

  els.importInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const incoming = await importJSON(file);
      const res = await confirmDialog({
        title: "가져올까요?",
        desc: `총 ${incoming.length}개의 기록을 가져옵니다. 기존 데이터는 유지되고, 같은 id는 덮어씁니다.`,
        okText: "가져오기",
        danger: false,
      });
      if (res !== "ok") return;

      const byId = new Map(entries.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      entries = Array.from(byId.values());
      saveEntries(entries);
      renderList();
      toast("가져오기 완료");
    } catch (err) {
      toast(err instanceof Error ? err.message : "가져오기 실패");
    }
  });

  // Keyboard shortcut: Cmd/Ctrl+K focus search
  window.addEventListener("keydown", (ev) => {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const mod = isMac ? ev.metaKey : ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "k") {
      ev.preventDefault();
      els.searchInput.focus();
    }
    // Toggle pin on selected entry: Cmd/Ctrl+P
    if (mod && ev.key.toLowerCase() === "p") {
      if (!selectedId) return;
      const idx = entries.findIndex((e) => e.id === selectedId);
      if (idx === -1) return;
      entries[idx].pinned = !entries[idx].pinned;
      entries[idx].updatedAt = Date.now();
      saveEntries(entries);
      renderList();
      toast(entries[idx].pinned ? "즐겨찾기 추가" : "즐겨찾기 해제");
    }
  });

  // first render
  renderList();

  // Load from Supabase on page load
  (async () => {
    try {
      els.countLabel.textContent = "불러오는 중…";
      const remote = await supabaseLoadEntries();
      entries = remote;
      saveEntries(entries);
      renderList();
      toast("Supabase에서 불러옴");
    } catch (e) {
      console.warn(e);
      renderList();
      toast("Supabase 불러오기 실패 (로컬 데이터 표시)");
    }
  })();
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    main();
  } catch (e) {
    console.error(e);
    alert("앱 초기화에 실패했습니다. 콘솔을 확인해 주세요.");
  }
});

