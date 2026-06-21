// ============================================================
//  모의고사 앱 로직
//  - Supabase가 설정되어 있으면 실제 DB 사용
//  - 설정 전이면 자동으로 데모(샘플) 모드로 동작
// ============================================================

const cfg = window.SUPABASE_CONFIG || {};
const CONFIGURED = cfg.url && !cfg.url.includes("YOUR-PROJECT");
let sb = null;
if (CONFIGURED && window.supabase) {
  sb = window.supabase.createClient(cfg.url, cfg.anonKey);
}

// ---------- 데모 데이터 (Supabase 미설정 시) ----------
const DEMO = {
  students: [{ id: "demo", name: "데모학생", pin: "0000" }],
  exams: [
    { id: "e1", round_no: 1, title: "데모 모의고사 (샘플)", subject: "English", published: true }
  ],
  questions: [
    {
      id: "q1", exam_id: "e1", q_no: 1, q_type: "mc",
      passage: "여기에 1번 문제의 지문/발문이 들어갑니다. 실제 시험지 파일을 넣으면 자동으로 채워집니다.",
      choices: ["선택지 1", "선택지 2", "선택지 3", "선택지 4", "선택지 5"],
      answer: "5", points: 3,
      explanation: "여기에 1번 해설이 들어갑니다.\n\n정답이 ⑤인 이유를 설명하는 자리입니다."
    },
    {
      id: "q25", exam_id: "e1", q_no: 25, q_type: "written",
      passage: "여기에 서답형 1번(25번) 발문이 들어갑니다.",
      choices: null,
      answer: "One thing that continually astonishes me is the degree to which we are influenced by sheer convenience.",
      points: 3,
      explanation: "서답형 모범답안과 해설이 이 자리에 들어갑니다."
    }
  ]
};

// ---------- 상태 ----------
let session = null;          // {id, name, pin}
let currentExam = null;      // exam object
let currentQuestions = [];   // questions of current exam
let favSet = new Set();      // 현재 회차의 즐겨찾기 q_no 집합

// ---------- 즐겨찾기 헬퍼 ----------
async function loadFavsForExam(examId){
  favSet = new Set();
  if(!sb || !session) return;
  try{
    const { data, error } = await sb.rpc("fav_list_by_exam",
      { p_name: session.name, p_pin: session.pin, p_exam_id: examId });
    if(error) throw error;
    (data||[]).forEach(r=>favSet.add(r.q_no));
  }catch(e){ console.error("fav load", e); }
}

async function toggleFav(examId, qNo){
  if(!sb || !session) return false;
  const { data, error } = await sb.rpc("fav_toggle",
    { p_name: session.name, p_pin: session.pin, p_exam_id: examId, p_q_no: qNo });
  if(error){ console.error("fav toggle", error); throw error; }
  if(data===true) favSet.add(qNo); else favSet.delete(qNo);
  return data===true;
}

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const views = {
  login: $("view-login"),
  home: $("view-home"),
  exam: $("view-exam"),
  question: $("view-question"),
};

// ---------- 로그인 ----------
$("btn-login").addEventListener("click", login);
$("in-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

async function login() {
  const name = $("in-name").value.trim();
  const pin = $("in-pin").value.trim();
  const errEl = $("login-err");
  errEl.textContent = "";
  if (!name || !pin) { errEl.textContent = "이름과 PIN을 모두 입력하세요."; return; }

  try {
    let found = null;
    if (sb) {
      const { data, error } = await sb.rpc("verify_login", { p_name: name, p_pin: pin });
      if (error) throw error;
      found = data && data[0];
    } else {
      found = DEMO.students.find((s) => s.name === name && s.pin === pin) || null;
    }
    if (!found) { errEl.textContent = "이름 또는 PIN이 일치하지 않아요."; return; }

    session = { id: found.id, name: found.name, pin };
    sessionStorage.setItem("mock_session", JSON.stringify(session));
    enterApp();
  } catch (e) {
    errEl.textContent = "로그인 중 오류가 발생했어요. 잠시 후 다시 시도하세요.";
    console.error(e);
  }
}

function enterApp() {
  views.login.classList.add("hidden");
  $("app").classList.remove("hidden");
  $("who-name").textContent = session.name;
  showHome();
}

$("btn-logout").addEventListener("click", () => {
  session = null;
  sessionStorage.removeItem("mock_session");
  $("app").classList.add("hidden");
  views.login.classList.remove("hidden");
  $("in-name").value = ""; $("in-pin").value = "";
});

// ---------- 데이터 조회 ----------
async function fetchExams() {
  if (sb) {
    const { data, error } = await sb.from("exams")
      .select("*").eq("published", true).order("round_no", { ascending: true });
    if (error) throw error;
    return data;
  }
  return DEMO.exams;
}
async function fetchQuestions(examId) {
  if (sb) {
    const { data, error } = await sb.from("questions")
      .select("*").eq("exam_id", examId).order("q_no", { ascending: true });
    if (error) throw error;
    return data;
  }
  return DEMO.questions.filter((q) => q.exam_id === examId);
}

// ---------- 홈: 회차 리스트 ----------
async function showHome() {
  swap("home");
  $("topbar-title").textContent = "모의고사";
  const listEl = $("exam-list");
  listEl.innerHTML = "";

  // 전체 즐겨찾기 진입 버튼
  const favEntry = document.createElement("button");
  favEntry.className = "fav-entry";
  favEntry.innerHTML = `⭐ 전체 즐겨찾기 모아보기 <span class="chev">›</span>`;
  favEntry.addEventListener("click", showAllFavorites);
  listEl.appendChild(favEntry);

  let exams = [];
  try { exams = await fetchExams(); } catch (e) { console.error(e); }
  $("exam-empty").classList.toggle("hidden", exams.length > 0);

  exams.forEach((ex) => {
    const row = document.createElement("button");
    row.className = "list-row";
    row.innerHTML =
      `<span class="badge">${ex.round_no}</span>
       <span class="meta"><span class="t">${escapeHtml(ex.title)}</span>
       <span class="s">${escapeHtml(ex.subject || "")} · ${ex.round_no}회차</span></span>
       <span class="chev">›</span>`;
    row.addEventListener("click", () => showExam(ex));
    listEl.appendChild(row);
  });
}

// ---------- 전체 즐겨찾기 (회차별 그룹) ----------
async function showAllFavorites() {
  swap("home");
  $("topbar-title").textContent = "⭐ 즐겨찾기";
  const listEl = $("exam-list");
  listEl.innerHTML = `<div class="loading show"><div class="spinner"></div>불러오는 중...</div>`;
  $("exam-empty").classList.add("hidden");

  let rows = [];
  try {
    const { data, error } = await sb.rpc("fav_list_all",
      { p_name: session.name, p_pin: session.pin });
    if (error) throw error;
    rows = data || [];
  } catch (e) { console.error(e); }

  listEl.innerHTML = "";
  const back = document.createElement("button");
  back.className = "fav-entry";
  back.innerHTML = `← 회차 목록으로`;
  back.addEventListener("click", showHome);
  listEl.appendChild(back);

  if (!rows.length) {
    const d = document.createElement("div");
    d.className = "empty"; d.textContent = "아직 즐겨찾기한 문항이 없어요.";
    listEl.appendChild(d);
    return;
  }

  // 회차별 그룹핑
  const groups = {};
  rows.forEach(r => {
    if (!groups[r.exam_id]) groups[r.exam_id] = { round_no: r.round_no, title: r.title, exam_id: r.exam_id, qnos: [] };
    groups[r.exam_id].qnos.push(r.q_no);
  });

  Object.values(groups)
    .sort((a,b)=>a.round_no-b.round_no)
    .forEach(g => {
      const card = document.createElement("div");
      card.className = "fav-group";
      card.innerHTML = `<div class="fav-group-title">${g.round_no}회차 · ${escapeHtml(g.title)}</div>`;
      const grid = document.createElement("div");
      grid.className = "qgrid";
      g.qnos.forEach(qno => {
        const b = document.createElement("button");
        b.className = "qbtn faved";
        b.innerHTML = `<span class="qstar">★</span>${qno}`;
        b.addEventListener("click", () => openFavQuestion(g.exam_id, g.title, g.round_no, qno));
        grid.appendChild(b);
      });
      card.appendChild(grid);
      listEl.appendChild(card);
    });
}

// 전체 즐겨찾기에서 특정 문항 열기 (회차 로드 후 해당 문제 표시)
async function openFavQuestion(examId, title, roundNo, qNo) {
  const exam = { id: examId, title, round_no: roundNo, subject: "" };
  currentExam = exam;
  try { currentQuestions = await fetchQuestions(examId); }
  catch(e){ currentQuestions = []; }
  await loadFavsForExam(examId);
  const q = currentQuestions.find(x => x.q_no === qNo);
  if (q) showQuestion(q);
  else showExam(exam);
}

// ---------- 회차: 문제 번호 그리드 ----------
async function showExam(exam) {
  currentExam = exam;
  swap("exam");
  $("topbar-title").textContent = `${exam.round_no}회차`;
  const wrap = $("exam-detail");
  wrap.innerHTML = `<div class="card"><h2 class="serif" style="margin:0 0 4px">${escapeHtml(exam.title)}</h2>
    <div class="s" style="color:var(--ink-soft);font-size:13px">${escapeHtml(exam.subject||"")}</div></div>`;

  try { currentQuestions = await fetchQuestions(exam.id); }
  catch (e) { currentQuestions = []; console.error(e); }

  await loadFavsForExam(exam.id);

  // 즐겨찾기 모아보기 버튼 (이 회차에 즐겨찾기가 있을 때만)
  if (favSet.size > 0) {
    const favBtn = document.createElement("button");
    favBtn.className = "fav-collect-btn";
    favBtn.innerHTML = `⭐ 이 회차 즐겨찾기 모아보기 (${favSet.size})`;
    favBtn.addEventListener("click", showFavInExam);
    wrap.appendChild(favBtn);
  }

  const mc = currentQuestions.filter((q) => q.q_type === "mc");
  const wr = currentQuestions.filter((q) => q.q_type === "written");

  if (mc.length) wrap.appendChild(makeGrid("객관식 Multiple Choice", mc));
  if (wr.length) wrap.appendChild(makeGrid("서답형 Written Response", wr));
  if (!currentQuestions.length) {
    const d = document.createElement("div");
    d.className = "empty"; d.textContent = "이 회차에는 아직 문제가 없어요.";
    wrap.appendChild(d);
  }
}

// 이 회차의 즐겨찾기 문항만 모아 보여주는 화면
function showFavInExam() {
  const favQs = currentQuestions.filter(q => favSet.has(q.q_no));
  const wrap = $("exam-detail");
  wrap.innerHTML = `<div class="card"><h2 class="serif" style="margin:0 0 4px">⭐ 즐겨찾기 — ${escapeHtml(currentExam.title)}</h2>
    <div class="s" style="color:var(--ink-soft);font-size:13px">${favQs.length}문항</div></div>`;
  const back = document.createElement("button");
  back.className = "fav-collect-btn";
  back.textContent = "← 회차 전체 보기";
  back.addEventListener("click", () => showExam(currentExam));
  wrap.appendChild(back);
  if (favQs.length) wrap.appendChild(makeGrid("즐겨찾기 문항", favQs));
  else {
    const d=document.createElement("div"); d.className="empty";
    d.textContent="이 회차에 즐겨찾기한 문항이 없어요."; wrap.appendChild(d);
  }
}

function makeGrid(label, qs) {
  const frag = document.createDocumentFragment();
  const lab = document.createElement("div");
  lab.className = "sect-label"; lab.textContent = label;
  frag.appendChild(lab);
  const grid = document.createElement("div");
  grid.className = "qgrid";
  qs.forEach((q) => {
    const b = document.createElement("button");
    b.className = "qbtn" + (favSet.has(q.q_no) ? " faved" : "");
    const star = favSet.has(q.q_no) ? `<span class="qstar">★</span>` : "";
    b.innerHTML = `${star}${q.q_no}<span class="tag">${q.points || 0}점</span>`;
    b.addEventListener("click", () => showQuestion(q));
    grid.appendChild(b);
  });
  frag.appendChild(grid);
  return frag;
}

// ---------- 문제 + 해설 ----------
function showQuestion(q) {
  swap("question");
  $("topbar-title").textContent = `${currentExam.round_no}회차 · ${q.q_no}번`;
  const el = $("question-detail");

  let choicesHtml = "";
  if (q.choices && q.choices.length) {
    choicesHtml = `<ul class="choices">${q.choices.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`;
  }

  const typeLabel = q.q_type === "written" ? "서답형" : "객관식";
  const ansDisplay = q.q_type === "mc" ? `${q.answer}번` : escapeHtml(q.answer || "");

  // 발문(첫 문단)과 영어 지문(나머지)을 빈 줄 기준으로 분리.
  // 발문은 들여쓰기 없이, 지문 문단은 첫 줄 들여쓰기 적용.
  const passageHtml = renderPassage(q.passage);

  el.innerHTML = `
    <div class="qhead">
      <span class="num">${q.q_no}</span>
      <span class="pts">${typeLabel} · ${q.points || 0}점</span>
      <button class="fav-btn ${favSet.has(q.q_no) ? "on" : ""}" id="fav-toggle" title="즐겨찾기">
        ${favSet.has(q.q_no) ? "★" : "☆"}</button>
    </div>
    <div class="passage-block">${passageHtml}</div>
    ${choicesHtml}
    <div class="explain-wrap">
      <button class="explain-btn" id="explain-toggle">해설 보기 ▾</button>
      <div class="explain-body" id="explain-body">
        <div class="ans-line"><span class="k">정답</span><span class="v">${ansDisplay}</span></div>
        <div class="passage">${q.explanation ? escapeHtml(q.explanation) : "해설이 아직 없습니다."}</div>
      </div>
    </div>`;

  // 즐겨찾기 토글
  const favBtn = $("fav-toggle");
  favBtn.addEventListener("click", async () => {
    favBtn.disabled = true;
    try{
      const on = await toggleFav(currentExam.id, q.q_no);
      favBtn.textContent = on ? "★" : "☆";
      favBtn.classList.toggle("on", on);
    }catch(e){ alert("즐겨찾기 저장 중 오류가 발생했어요."); }
    finally{ favBtn.disabled = false; }
  });

  const toggle = $("explain-toggle");
  const body = $("explain-body");
  toggle.addEventListener("click", () => {
    const open = body.classList.toggle("open");
    toggle.textContent = open ? "해설 닫기 ▴" : "해설 보기 ▾";
  });
}

// ---------- 화면 전환 ----------
function swap(name) {
  views.home.classList.add("hidden");
  views.exam.classList.add("hidden");
  views.question.classList.add("hidden");
  views[name].classList.remove("hidden");
  window.scrollTo({ top: 0 });
}
$("back-to-home").addEventListener("click", showHome);
$("back-to-exam").addEventListener("click", () => showExam(currentExam));

// ---------- 유틸 ----------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

// 발문(첫 문단) + 영어 지문(나머지)을 빈 줄로 나눠 렌더링.
// 첫 문단은 들여쓰기 없음(.prompt), 이후 문단은 첫 줄 들여쓰기(.passage).
// 문단 안의 줄바꿈은 공백으로 합쳐 양쪽정렬이 컨테이너 폭을 따라 적용되게 한다.
function renderPassage(text) {
  if (!text) return "";
  // 문단 내부 단일 줄바꿈 → 공백 (빈 줄(문단 구분)은 보존)
  const flow = s => String(s).replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ").trim();
  const parts = String(text).split(/\n\s*\n/); // 빈 줄 기준 문단 분리
  if (parts.length === 1) {
    return `<div class="passage">${escapeHtml(flow(parts[0]))}</div>`;
  }
  const prompt = flow(parts[0]);
  const rest = parts.slice(1).map(flow).filter(Boolean);
  let html = `<div class="prompt">${escapeHtml(prompt)}</div>`;
  html += rest.map(p => `<div class="passage">${escapeHtml(p)}</div>`).join("");
  return html;
}

// ---------- 세션 복원 ----------
(function restore() {
  const saved = sessionStorage.getItem("mock_session");
  if (saved) { try { session = JSON.parse(saved); enterApp(); } catch (e) {} }
})();

// 데모 모드 안내
if (!sb) {
  console.info("⚠️ 데모 모드: config.js에 Supabase 정보를 넣으면 실제 DB로 전환됩니다. (데모 로그인: 데모학생 / 0000)");
}
