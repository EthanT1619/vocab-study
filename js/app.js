/* 단어 시험 준비 - 메인 앱 */

const STORAGE_KEY = 'vocab-study-presets';
const PRESETS_BASE = 'presets/';

const FIELD_LABELS = {
  korean: '한글 뜻',
  english: '영어 뜻',
  example: '예시문장',
};

const ROUND_INFO = [
  { label: '라운드 1', title: '페어 찾기' },
  { label: '라운드 2', title: '뜻 맞추기' },
  { label: '라운드 3', title: '스펠링 맞추기' },
];

// ─── 상태 ───
let words = [];
let fields = { korean: true, english: false, example: false };
let timerEnabled = false;
let timerSeconds = 120;

let gameWords = [];
let currentRound = 0;
let isRetryMode = false;

let score = 0;
let correctCount = 0;
let wrongCount = 0;
let wrongWordIds = new Set();

let timerInterval = null;
let timeLeft = 0;

// 라운드 1
const MAX_PAIRS_PER_BATCH = 4;
let matchCards = [];
let pairQueue = [];
let selectedCard = null;
let batchMatchedCount = 0;
let currentBatchSize = 0;
let completedPairs = 0;
let totalPairs = 0;

// 라운드 2
let quizQueue = [];
let quizTotal = 0;
let currentQuiz = null;

// 라운드 3
let spellingQueue = [];
let spellingTotal = 0;
let currentSpelling = null;
let spellingHintField = null;
let shuffledLetters = [];
let selectedLetters = [];
let usedLetterBtns = new Set();

// ─── DOM ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const phaseSetup = $('#phase-setup');
const phaseRound = $('#phase-round');
const phaseResult = $('#phase-result');

// ─── 유틸 ───
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getActiveFields() {
  return Object.keys(fields).filter((k) => fields[k]);
}

function calcGrid(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

/** 라운드 3 전용: "call - called"처럼 공백+하이픈 형태만 분리 */
function getSpellingParts(wordText) {
  if (!/-/.test(wordText)) return [wordText];
  if (!/\s-\s|-\s|\s-/.test(wordText)) return [wordText];
  const parts = wordText.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [wordText];
}

function buildSpellingQueue(wordList) {
  const items = [];
  wordList.forEach((w) => {
    const parts = getSpellingParts(w.word);
    parts.forEach((part, index) => {
      items.push({
        wordEntry: w,
        spellingText: part,
        partIndex: index,
        partTotal: parts.length,
      });
    });
  });
  return shuffle(items);
}

function countSpellingItems(wordList) {
  return wordList.reduce((sum, w) => sum + getSpellingParts(w.word).length, 0);
}

function showToast(msg, type = 'info') {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 2200);
}

function showPhase(phase) {
  [phaseSetup, phaseRound, phaseResult].forEach((el) => el.classList.remove('active'));
  phase.classList.add('active');
  updateHeaderHomeButton();
}

function updateHeaderHomeButton() {
  const btn = $('#btn-header-home');
  if (!btn) return;
  const inGame = phaseRound.classList.contains('active') || phaseResult.classList.contains('active');
  btn.hidden = !inGame;
}

function goHomeFromGame() {
  if (phaseRound.classList.contains('active')) {
    if (!confirm('학습을 중단하고 단어 목록으로 돌아갈까요?')) return;
  }
  resetToSetup();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateStats(progress, total) {
  if (progress !== null && total !== null) {
    $('#progress-text').textContent = `${progress} / ${total}`;
  }
  $('#score-text').textContent = score;
  const totalAttempts = correctCount + wrongCount;
  $('#accuracy-text').textContent = totalAttempts > 0
    ? `${Math.round((correctCount / totalAttempts) * 100)}%`
    : '-';
}

function addScore(points) {
  score += points;
  $('#score-text').textContent = score;
}

const SFX = {
  correct: 'assets/correct.mp3',
  wrong: 'assets/wrong.mp3',
};
const SFX_TTS_START_RATIO = 0.8;
const sfxDurationMs = { correct: 950, wrong: 950 };
let audioUnlocked = false;
let activeSfxAudio = null;
let pendingSpeakTimer = null;

function primeSpeechVoices() {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.getVoices();
}

function preloadSfx() {
  Object.entries(SFX).forEach(([key, src]) => {
    const probe = new Audio(src);
    probe.preload = 'auto';
    probe.addEventListener('loadedmetadata', () => {
      if (probe.duration && Number.isFinite(probe.duration)) {
        sfxDurationMs[key] = Math.ceil(probe.duration * 1000);
      }
    }, { once: true });
    probe.load();
  });
}

function clearPendingSpeak() {
  if (pendingSpeakTimer) {
    clearTimeout(pendingSpeakTimer);
    pendingSpeakTimer = null;
  }
}

function stopActiveSfx() {
  if (activeSfxAudio) {
    activeSfxAudio.pause();
    activeSfxAudio = null;
  }
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  Object.values(SFX).forEach((src) => {
    const probe = new Audio(src);
    probe.volume = 0.001;
    probe.play().then(() => probe.pause()).catch(() => {});
  });
  primeSpeechVoices();
  preloadSfx();
  window.speechSynthesis?.addEventListener('voiceschanged', primeSpeechVoices, { once: true });
}

function warmSpeechInGesture() {
  primeSpeechVoices();
}

function speakEnglish(text) {
  if (!text?.trim() || !('speechSynthesis' in window)) return;

  unlockAudio();
  primeSpeechVoices();

  const synth = window.speechSynthesis;
  const phrase = text.trim();

  if (synth.speaking) {
    synth.cancel();
  }

  const voices = synth.getVoices();
  const voice = voices.find((v) => v.lang.startsWith('en-US')) || voices.find((v) => v.lang.startsWith('en'));

  const utter = new SpeechSynthesisUtterance(phrase);
  utter.lang = 'en-US';
  utter.rate = 0.9;
  utter.volume = 1;
  if (voice) utter.voice = voice;

  synth.speak(utter);
}

function playSfx(type) {
  const src = SFX[type];
  if (!src) return null;
  const audio = new Audio(src);
  audio.play().catch(() => {});
  return audio;
}

function playSfxThenSpeak(sfxType, speakText) {
  const phrase = speakText?.trim();
  unlockAudio();
  primeSpeechVoices();
  clearPendingSpeak();
  stopActiveSfx();

  const src = SFX[sfxType];
  if (src) {
    const audio = new Audio(src);
    activeSfxAudio = audio;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  if (!phrase) return;

  const fullMs = sfxDurationMs[sfxType] || 950;
  const delayMs = Math.ceil(fullMs * SFX_TTS_START_RATIO);
  // Schedule in the click turn (not in audio "ended") so Chrome still allows TTS.
  pendingSpeakTimer = setTimeout(() => {
    pendingSpeakTimer = null;
    speakEnglish(phrase);
  }, delayMs);
}

function getWordTextById(wordId) {
  const entry = gameWords.find((w) => w.id === wordId) || words.find((w) => w.id === wordId);
  return entry?.word || '';
}

function recordCorrect(speakText) {
  correctCount++;
  addScore(10);
  if (speakText) {
    playSfxThenSpeak('correct', speakText);
  } else {
    playSfx('correct');
  }
  updateStats(null, null);
}

function recordWrong(wordId, speakText) {
  wrongCount++;
  wrongWordIds.add(wordId);
  const phrase = speakText || getWordTextById(wordId);
  if (phrase) {
    playSfxThenSpeak('wrong', phrase);
  } else {
    playSfx('wrong');
  }
  updateStats(null, null);
}

// ─── 타이머 ───
function startTimer() {
  stopTimer();
  if (!timerEnabled) {
    $('#stat-timer').hidden = true;
    return;
  }
  $('#stat-timer').hidden = false;
  timeLeft = timerSeconds;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      stopTimer();
      handleTimeUp();
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  const el = $('#timer-text');
  el.textContent = formatTime(timeLeft);
  el.classList.remove('warning', 'danger');
  if (timeLeft <= 10) el.classList.add('danger');
  else if (timeLeft <= 30) el.classList.add('warning');
}

function handleTimeUp() {
  showToast('시간이 종료되었습니다!', 'error');
  if (currentRound === 1) finishRound1();
  else if (currentRound === 2) finishRound2();
  else if (currentRound === 3) finishRound3();
}

// ─── 세팅: 필드 토글 ───
function updateFieldVisibility() {
  fields.korean = $('#field-korean').checked;
  fields.english = $('#field-english').checked;
  fields.example = $('#field-example').checked;

  $$('[data-field]').forEach((el) => {
    const f = el.dataset.field;
    el.hidden = !fields[f];
  });
}

function validateFields() {
  const active = getActiveFields();
  if (active.length === 0) {
    showToast('한글 뜻, 영어 뜻, 예시문장 중 하나 이상을 선택해주세요.', 'error');
    return false;
  }
  return true;
}

// ─── 세팅: 단어 관리 ───
function renderWordList() {
  const list = $('#word-list');
  const panel = $('#word-list-panel');
  const count = $('#word-count');
  const startBtn = $('#btn-start');

  count.textContent = words.length;
  panel.hidden = words.length === 0;
  startBtn.disabled = words.length === 0;

  list.innerHTML = words.map((w) => {
    const details = [];
    if (fields.korean && w.korean) details.push(`<span>한글: ${escapeHtml(w.korean)}</span>`);
    if (fields.english && w.english) details.push(`<span>영어: ${escapeHtml(w.english)}</span>`);
    if (fields.example && w.example) details.push(`<span>예문: ${escapeHtml(w.example)}</span>`);
    return `
      <li class="word-list-item">
        <div>
          <div class="word-main">${escapeHtml(w.word)}</div>
          <div class="word-details">${details.join('')}</div>
        </div>
        <button type="button" class="btn-remove-word" data-id="${w.id}" title="삭제">×</button>
      </li>`;
  }).join('');

  list.querySelectorAll('.btn-remove-word').forEach((btn) => {
    btn.addEventListener('click', () => {
      words = words.filter((w) => w.id !== btn.dataset.id);
      renderWordList();
    });
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function addWord() {
  if (!validateFields()) return;

  const word = $('#input-word').value.trim();
  const korean = $('#input-korean').value.trim();
  const english = $('#input-english').value.trim();
  const example = $('#input-example').value.trim();

  if (!word) {
    showToast('영어 단어를 입력해주세요.', 'error');
    $('#input-word').focus();
    return;
  }

  const active = getActiveFields();
  for (const f of active) {
    const val = { korean, english, example }[f];
    if (!val) {
      showToast(`${FIELD_LABELS[f]}을(를) 입력해주세요.`, 'error');
      return;
    }
  }

  words.push({ id: generateId(), word, korean, english, example });
  renderWordList();

  $('#input-word').value = '';
  $('#input-korean').value = '';
  $('#input-english').value = '';
  $('#input-example').value = '';
  $('#input-word').focus();
  showToast('단어가 추가되었습니다.', 'success');
}

function clearInputs() {
  $('#input-word').value = '';
  $('#input-korean').value = '';
  $('#input-english').value = '';
  $('#input-example').value = '';
}

// ─── 프리셋 (localStorage) ───
function getPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function inferFieldsFromWords(wordList) {
  const has = (key) => wordList.some((w) => (w[key] || '').trim());
  return {
    korean: has('korean'),
    english: has('english'),
    example: has('example'),
  };
}

function normalizeWordEntry(raw) {
  const word = (raw.word || '').trim();
  if (!word) return null;
  return {
    id: raw.id || generateId(),
    word,
    korean: (raw.korean || '').trim(),
    english: (raw.english || '').trim(),
    example: (raw.example || '').trim(),
  };
}

function applyWordSet(wordList, options = {}) {
  const normalized = wordList.map(normalizeWordEntry).filter(Boolean);
  if (normalized.length === 0) {
    showToast('불러올 단어가 없습니다.', 'error');
    return false;
  }

  fields = options.fields ? { ...options.fields } : inferFieldsFromWords(normalized);
  words = normalized;

  if (options.timerEnabled !== undefined) timerEnabled = options.timerEnabled;
  if (options.timerSeconds !== undefined) timerSeconds = options.timerSeconds;

  $('#field-korean').checked = fields.korean;
  $('#field-english').checked = fields.english;
  $('#field-example').checked = fields.example;
  $('#timer-enabled').checked = timerEnabled;
  $('#timer-seconds').value = timerSeconds;
  $('#timer-input-group').hidden = !timerEnabled;
  if (options.presetName !== undefined) $('#preset-name').value = options.presetName;

  updateFieldVisibility();
  renderWordList();
  return true;
}

let builtInLevels = [];
let builtInBrowseLevel = null;
let builtInBrowseLesson = null;

function getBuiltInLoadItems(lesson) {
  if (lesson?.lists?.length) return lesson.lists;
  if (lesson?.file) return [lesson];
  return [];
}

function renderBuiltInBrowser() {
  const container = $('#builtin-preset-list');
  const breadcrumb = $('#builtin-preset-breadcrumb');
  if (!container) return;

  if (!builtInBrowseLevel) {
    builtInBrowseLesson = null;
    if (breadcrumb) breadcrumb.hidden = true;

    if (builtInLevels.length === 0) {
      container.innerHTML = '<p class="empty-hint">등록된 학원 단어 목록이 없습니다.</p>';
      return;
    }

    container.className = 'builtin-preset-list builtin-folder-grid';
    container.innerHTML = builtInLevels.map((level, i) => {
      const lessonCount = level.lessons?.length || 0;
      return `
        <button type="button" class="builtin-folder-item" data-level-idx="${i}">
          <span class="builtin-folder-name">${escapeHtml(level.name)}</span>
          <span class="builtin-folder-meta">${lessonCount}개 레슨</span>
        </button>`;
    }).join('');

    container.querySelectorAll('[data-level-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        builtInBrowseLevel = builtInLevels[parseInt(btn.dataset.levelIdx, 10)];
        builtInBrowseLesson = null;
        renderBuiltInBrowser();
      });
    });
    return;
  }

  if (breadcrumb) {
    breadcrumb.hidden = false;
    if (builtInBrowseLesson) {
      breadcrumb.innerHTML = `
        <button type="button" class="btn btn-text btn-small" id="btn-builtin-back">← ${escapeHtml(builtInBrowseLevel.name)}</button>
        <span class="builtin-preset-path">${escapeHtml(builtInBrowseLevel.name)} / ${escapeHtml(builtInBrowseLesson.name)}</span>`;
      $('#btn-builtin-back')?.addEventListener('click', () => {
        builtInBrowseLesson = null;
        renderBuiltInBrowser();
      });
    } else {
      breadcrumb.innerHTML = `
        <button type="button" class="btn btn-text btn-small" id="btn-builtin-back">← 레벨 목록</button>
        <span class="builtin-preset-path">${escapeHtml(builtInBrowseLevel.name)}</span>`;
      $('#btn-builtin-back')?.addEventListener('click', () => {
        builtInBrowseLevel = null;
        builtInBrowseLesson = null;
        renderBuiltInBrowser();
      });
    }
  }

  if (builtInBrowseLesson) {
    const items = getBuiltInLoadItems(builtInBrowseLesson);
    container.className = 'builtin-preset-list';

    if (items.length === 0) {
      container.innerHTML = '<p class="empty-hint">등록된 단어 목록이 없습니다.</p>';
      return;
    }

    container.innerHTML = items.map((entry, i) => `
      <div class="builtin-preset-item">
        <div class="builtin-preset-item-info">
          <div class="builtin-preset-item-name">${escapeHtml(entry.name)}</div>
          ${entry.description ? `<div class="builtin-preset-item-meta">${escapeHtml(entry.description)}</div>` : ''}
        </div>
        <button type="button" class="btn btn-secondary btn-small" data-list-idx="${i}">불러오기</button>
      </div>
    `).join('');

    container.querySelectorAll('[data-list-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        loadBuiltInPreset(items[parseInt(btn.dataset.listIdx, 10)]);
      });
    });
    return;
  }

  const lessons = builtInBrowseLevel.lessons || [];
  container.className = 'builtin-preset-list';

  if (lessons.length === 0) {
    container.innerHTML = '<p class="empty-hint">등록된 레슨이 없습니다.</p>';
    return;
  }

  container.innerHTML = lessons.map((lesson, i) => {
    const listCount = lesson.lists?.length || (lesson.file ? 1 : 0);
    const actionLabel = lesson.lists?.length ? '열기' : '불러오기';
    return `
      <div class="builtin-preset-item">
        <div class="builtin-preset-item-info">
          <div class="builtin-preset-item-name">${escapeHtml(lesson.name)}</div>
          <div class="builtin-preset-item-meta">${listCount}개 목록</div>
        </div>
        <button type="button" class="btn btn-secondary btn-small" data-lesson-idx="${i}">${actionLabel}</button>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-lesson-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const lesson = lessons[parseInt(btn.dataset.lessonIdx, 10)];
      if (lesson.lists?.length) {
        builtInBrowseLesson = lesson;
        renderBuiltInBrowser();
        return;
      }
      loadBuiltInPreset(lesson);
    });
  });
}

async function loadBuiltInManifest() {
  const container = $('#builtin-preset-list');
  if (!container) return;

  try {
    const res = await fetch(`${PRESETS_BASE}manifest.json`);
    if (!res.ok) throw new Error('manifest not found');
    const data = await res.json();
    builtInLevels = data.levels || [];
    builtInBrowseLevel = null;
    builtInBrowseLesson = null;
    renderBuiltInBrowser();
  } catch {
    container.innerHTML = '<p class="empty-hint">학원 단어 목록을 불러올 수 없습니다.</p>';
  }
}

async function loadBuiltInPreset(entry) {
  if (!entry?.file) return;

  try {
    const res = await fetch(`${PRESETS_BASE}${entry.file}`);
    if (!res.ok) throw new Error('preset file not found');
    const data = await res.json();
    const wordList = Array.isArray(data) ? data : data.words;
    if (!Array.isArray(wordList)) throw new Error('invalid preset format');

    const options = {
      presetName: '',
      timerEnabled: entry.timerEnabled,
      timerSeconds: entry.timerSeconds,
    };
    if (entry.fields) options.fields = entry.fields;

    if (applyWordSet(wordList, options)) {
      showToast(`"${entry.name}" 단어 목록을 불러왔습니다.`, 'success');
    }
  } catch {
    showToast(`"${entry.name}" 목록을 불러오지 못했습니다.`, 'error');
  }
}

function savePresets(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function renderPresets() {
  const presets = getPresets();
  const container = $('#preset-list');
  const names = Object.keys(presets);

  if (names.length === 0) {
    container.innerHTML = '<p class="empty-hint">저장된 프리셋이 없습니다.</p>';
    return;
  }

  container.innerHTML = names.map((name) => {
    const p = presets[name];
    const wordCount = p.words?.length || 0;
    const activeFields = Object.entries(p.fields || {})
      .filter(([, v]) => v)
      .map(([k]) => FIELD_LABELS[k])
      .join(', ');
    return `
      <div class="preset-item">
        <div class="preset-item-info">
          <div class="preset-item-name">${escapeHtml(name)}</div>
          <div class="preset-item-meta">${wordCount}개 단어 · ${escapeHtml(activeFields)}</div>
        </div>
        <div class="preset-item-actions">
          <button type="button" class="btn btn-secondary btn-small" data-action="load" data-name="${escapeHtml(name)}">불러오기</button>
          <button type="button" class="btn btn-text btn-danger-text btn-small" data-action="delete" data-name="${escapeHtml(name)}">삭제</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.name;
      if (btn.dataset.action === 'load') loadPreset(name);
      else deletePreset(name);
    });
  });
}

function savePreset() {
  const name = $('#preset-name').value.trim();
  if (!name) {
    showToast('프리셋 이름을 입력해주세요.', 'error');
    return;
  }
  if (words.length === 0) {
    showToast('저장할 단어가 없습니다.', 'error');
    return;
  }

  const presets = getPresets();
  presets[name] = {
    fields: { ...fields },
    words: words.map(({ id, word, korean, english, example }) => ({ id, word, korean, english, example })),
    timerEnabled,
    timerSeconds,
    savedAt: new Date().toISOString(),
  };
  savePresets(presets);
  renderPresets();
  showToast(`"${name}" 프리셋이 저장되었습니다.`, 'success');
}

function loadPreset(name) {
  const presets = getPresets();
  const p = presets[name];
  if (!p) return;

  applyWordSet(p.words, {
    fields: p.fields,
    timerEnabled: p.timerEnabled || false,
    timerSeconds: p.timerSeconds || 120,
    presetName: name,
  });
  showToast(`"${name}" 프리셋을 불러왔습니다.`, 'success');
}

function deletePreset(name) {
  if (!confirm(`"${name}" 프리셋을 삭제할까요?`)) return;
  const presets = getPresets();
  delete presets[name];
  savePresets(presets);
  renderPresets();
  showToast('프리셋이 삭제되었습니다.', 'info');
}

// ─── 게임 시작 ───
function startGame(retryOnly = false) {
  if (!validateFields()) return;
  if (words.length === 0) {
    showToast('단어를 먼저 추가해주세요.', 'error');
    return;
  }

  isRetryMode = retryOnly;
  gameWords = retryOnly
    ? words.filter((w) => wrongWordIds.has(w.id))
    : [...words];

  if (gameWords.length === 0) {
    showToast('복습할 틀린 단어가 없습니다.', 'info');
    return;
  }

  score = 0;
  correctCount = 0;
  wrongCount = 0;
  if (!retryOnly) wrongWordIds = new Set();

  primeSpeechVoices();

  currentRound = 1;
  showPhase(phaseRound);
  startRound1();
}

function resetToSetup() {
  stopTimer();
  clearPendingSpeak();
  stopActiveSfx();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  showPhase(phaseSetup);
  isRetryMode = false;
}

// ─── 라운드 1: 페어 찾기 ───
function buildPairQueue() {
  const active = getActiveFields();
  const pairs = [];
  gameWords.forEach((w) => {
    active.forEach((field) => {
      pairs.push({
        pairKey: `${w.id}-${field}`,
        wordId: w.id,
        wordText: w.word,
        meaningText: w[field],
        field,
      });
    });
  });
  return shuffle(pairs);
}

function renderMatchBatch() {
  const grid = $('#match-grid');
  const { cols } = calcGrid(matchCards.length);
  grid.style.gridTemplateColumns = `repeat(${cols}, minmax(90px, 1fr))`;

  grid.innerHTML = matchCards.map((card) => `
    <div class="match-card type-${card.type}" data-id="${card.id}">
      ${escapeHtml(card.text)}
    </div>
  `).join('');

  grid.querySelectorAll('.match-card').forEach((el) => {
    el.addEventListener('click', () => onMatchCardClick(el));
  });
}

function loadNextMatchBatch() {
  selectedCard = null;
  batchMatchedCount = 0;

  const batch = pairQueue.splice(0, MAX_PAIRS_PER_BATCH);
  if (batch.length === 0) {
    finishRound1();
    return;
  }

  currentBatchSize = batch.length;
  matchCards = [];
  batch.forEach((pair) => {
    matchCards.push({
      id: generateId(),
      wordId: pair.wordId,
      type: 'word',
      text: pair.wordText,
      pairKey: pair.pairKey,
    });
    matchCards.push({
      id: generateId(),
      wordId: pair.wordId,
      type: pair.field,
      text: pair.meaningText,
      pairKey: pair.pairKey,
    });
  });

  matchCards = shuffle(matchCards);
  renderMatchBatch();
}

function startRound1() {
  const info = ROUND_INFO[0];
  $('#round-label').textContent = info.label;
  $('#round-title').textContent = info.title;

  $('#round1-content').hidden = false;
  $('#round2-content').hidden = true;
  $('#round3-content').hidden = true;

  pairQueue = buildPairQueue();
  completedPairs = 0;
  totalPairs = pairQueue.length;

  updateStats(0, totalPairs);
  startTimer();
  loadNextMatchBatch();
}

function onMatchCardClick(el) {
  if (el.classList.contains('matched')) return;

  const cardId = el.dataset.id;
  const card = matchCards.find((c) => c.id === cardId);
  if (!card) return;

  if (selectedCard === null) {
    selectedCard = { el, card };
    el.classList.add('selected');
    return;
  }

  if (selectedCard.el === el) {
    el.classList.remove('selected');
    selectedCard = null;
    return;
  }

  const first = selectedCard;
  selectedCard = null;
  first.el.classList.remove('selected');

  const isWordMeaningPair =
    (first.card.type === 'word' && card.type !== 'word') ||
    (card.type === 'word' && first.card.type !== 'word');

  const isMatch = isWordMeaningPair && first.card.wordId === card.wordId;

  if (isMatch) {
    const wordCard = first.card.type === 'word' ? first.card : card;
    first.el.classList.add('matched');
    el.classList.add('matched');
    batchMatchedCount++;
    completedPairs++;
    recordCorrect(wordCard.text);
    updateStats(completedPairs, totalPairs);
    showToast('정답!', 'success');

    if (batchMatchedCount >= currentBatchSize) {
      if (pairQueue.length === 0) {
        setTimeout(finishRound1, 600);
      } else {
        showToast('다음 카드 세트!', 'info');
        setTimeout(loadNextMatchBatch, 700);
      }
    }
  } else {
    if (first.card.wordId !== card.wordId) {
      recordWrong(first.card.wordId);
    }
    showToast('틀렸어요. 다시 시도해보세요.', 'error');
    first.el.classList.add('selected');
    setTimeout(() => first.el.classList.remove('selected'), 400);
    el.classList.add('selected');
    setTimeout(() => el.classList.remove('selected'), 400);
  }
}

function finishRound1() {
  stopTimer();
  currentRound = 2;
  startRound2();
}

// ─── 라운드 2: 객관식 ───
function startRound2() {
  const info = ROUND_INFO[1];
  $('#round-label').textContent = info.label;
  $('#round-title').textContent = info.title;

  $('#round1-content').hidden = true;
  $('#round2-content').hidden = false;
  $('#round3-content').hidden = true;

  const active = getActiveFields();
  quizQueue = shuffle(
    gameWords.flatMap((w) =>
      active
        .filter((field) => (w[field] || '').trim())
        .map((field) => ({ word: w, field }))
    )
  );
  quizTotal = quizQueue.length;

  updateStats(0, quizTotal);
  startTimer();
  showNextQuiz();
}

function showNextQuiz() {
  if (quizQueue.length === 0) {
    finishRound2();
    return;
  }

  currentQuiz = quizQueue.shift();
  const w = currentQuiz.word;
  const field = currentQuiz.field;

  $('#quiz-prompt').innerHTML = `
    <div class="quiz-prompt-type">${FIELD_LABELS[field]}</div>
    <div class="quiz-prompt-text">${escapeHtml(w[field])}</div>
  `;

  const choiceCount = Math.min(4, gameWords.length);
  const others = shuffle(gameWords.filter((gw) => gw.id !== w.id));
  const choices = [{ word: w.word, id: w.id, correct: true }];
  for (let i = 0; i < choiceCount - 1 && i < others.length; i++) {
    choices.push({ word: others[i].word, id: others[i].id, correct: false });
  }
  const finalChoices = shuffle(choices);

  const container = $('#quiz-choices');
  container.innerHTML = finalChoices.map((c) => `
    <button type="button" class="quiz-choice" data-correct="${c.correct}" data-word-id="${c.id}">
      ${escapeHtml(c.word)}
    </button>
  `).join('');

  container.querySelectorAll('.quiz-choice').forEach((btn) => {
    btn.addEventListener('click', () => onQuizChoice(btn));
  });

  const done = quizTotal - quizQueue.length - 1;
  updateStats(done, quizTotal);
}

function onQuizChoice(btn) {
  if (btn.classList.contains('disabled')) return;

  const isCorrect = btn.dataset.correct === 'true';
  const wordId = currentQuiz.word.id;

  $$('.quiz-choice').forEach((b) => {
    b.classList.add('disabled');
    if (b.dataset.correct === 'true') b.classList.add('correct');
    else if (b === btn && !isCorrect) b.classList.add('wrong');
  });

  if (isCorrect) {
    recordCorrect(currentQuiz.word.word);
    showToast('정답!', 'success');
  } else {
    recordWrong(wordId, currentQuiz.word.word);
    showToast(`오답! 정답: ${currentQuiz.word.word}`, 'error');
  }

  setTimeout(showNextQuiz, 900);
}

function finishRound2() {
  stopTimer();
  currentRound = 3;
  startRound3();
}

// ─── 라운드 3: 스펠링 ───
function startRound3() {
  const info = ROUND_INFO[2];
  $('#round-label').textContent = info.label;
  $('#round-title').textContent = info.title;

  $('#round1-content').hidden = true;
  $('#round2-content').hidden = true;
  $('#round3-content').hidden = false;

  spellingQueue = buildSpellingQueue(gameWords);
  spellingTotal = spellingQueue.length;
  updateStats(0, spellingTotal);
  startTimer();
  showNextSpelling();
}

function showNextSpelling() {
  if (spellingQueue.length === 0) {
    finishRound3();
    return;
  }

  currentSpelling = spellingQueue.shift();
  const active = getActiveFields();
  spellingHintField = active[Math.floor(Math.random() * active.length)];
  shuffledLetters = shuffle(currentSpelling.spellingText.split(''));
  selectedLetters = [];
  usedLetterBtns = new Set();
  renderSpelling(false);
  const done = spellingTotal - spellingQueue.length - 1;
  updateStats(done, spellingTotal);
}

function renderSpelling(reshuffle = true) {
  const w = currentSpelling.wordEntry;
  const target = currentSpelling.spellingText;
  const hintText = w[spellingHintField] || '';

  let hintHtml = hintText
    ? `<div class="spelling-hint-main">
        <span><strong>${FIELD_LABELS[spellingHintField]}</strong>: ${escapeHtml(hintText)}</span>
        <button type="button" class="btn-speak-word" id="btn-spelling-speak" aria-label="단어 발음 듣기" title="단어 발음 듣기">🔊</button>
      </div>`
    : '글자를 순서대로 눌러 단어를 완성하세요.';

  if (currentSpelling.partTotal > 1) {
    hintHtml += `<br><span class="spelling-part-label">${currentSpelling.partIndex + 1} / ${currentSpelling.partTotal}</span>`;
  }

  $('#spelling-hint').innerHTML = hintHtml;
  $('#btn-spelling-speak')?.addEventListener('click', () => {
    speakEnglish(currentSpelling.spellingText);
  });

  renderSpellingSlots();

  if (reshuffle) {
    shuffledLetters = shuffle(target.split(''));
    selectedLetters = [];
    usedLetterBtns = new Set();
  }

  const letters = target.split('');
  $('#spelling-letters').innerHTML = shuffledLetters.map((ch, i) =>
    `<button type="button" class="spelling-letter ${usedLetterBtns.has(i) ? 'used' : ''}" data-char="${ch}" data-idx="${i}">
      ${escapeHtml(ch)}
    </button>`
  ).join('');

  $('#spelling-letters').querySelectorAll('.spelling-letter').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('used')) return;
      const idx = parseInt(btn.dataset.idx, 10);
      selectedLetters.push(btn.dataset.char);
      usedLetterBtns.add(idx);
      btn.classList.add('used');
      renderSpellingSlots();

      if (selectedLetters.length === letters.length) {
        checkSpelling();
      }
    });
  });
}

function renderSpellingSlots() {
  const letters = currentSpelling.spellingText.split('');
  const slots = letters.map((_, i) =>
    `<div class="spelling-slot ${selectedLetters[i] ? 'filled' : ''}">
      ${escapeHtml(selectedLetters[i] || '')}
    </div>`
  ).join('');
  $('#spelling-answer').innerHTML = slots;
}

function checkSpelling() {
  const answer = selectedLetters.join('');
  const correct = currentSpelling.spellingText;

  if (answer.toLowerCase() === correct.toLowerCase()) {
    recordCorrect(currentSpelling.spellingText);
    showToast('정답!', 'success');
    setTimeout(showNextSpelling, 800);
  } else {
    recordWrong(currentSpelling.wordEntry.id, currentSpelling.spellingText);
    showToast(`오답! 정답: ${correct}`, 'error');
    setTimeout(showNextSpelling, 1200);
  }
}

function resetSpellingSelection() {
  selectedLetters = [];
  usedLetterBtns = new Set();
  renderSpelling(false);
}

function finishRound3() {
  stopTimer();
  showResults();
}

// ─── 결과 ───
function showResults() {
  showPhase(phaseResult);

  const totalAttempts = correctCount + wrongCount;
  const accuracy = totalAttempts > 0 ? Math.round((correctCount / totalAttempts) * 100) : 0;

  $('#result-title').textContent = isRetryMode ? '🔄 복습 완료!' : '🎉 학습 완료!';
  $('#result-score').textContent = score;
  $('#result-accuracy').textContent = `${accuracy}%`;
  $('#result-correct').textContent = correctCount;
  $('#result-wrong').textContent = wrongCount;

  const wrongSection = $('#wrong-words-section');
  const wrongList = $('#wrong-words-list');
  const retryBtn = $('#btn-retry-wrong');

  if (wrongWordIds.size > 0) {
    wrongSection.hidden = false;
    retryBtn.hidden = false;
    const wrongWords = words.filter((w) => wrongWordIds.has(w.id));
    wrongList.innerHTML = wrongWords.map((w) => `<li>${escapeHtml(w.word)}</li>`).join('');
  } else {
    wrongSection.hidden = true;
    retryBtn.hidden = true;
  }
}

function retryWrongWords() {
  unlockAudio();
  warmSpeechInGesture();
  startGame(true);
}

function restartGame() {
  unlockAudio();
  warmSpeechInGesture();
  startGame(false);
}

// ─── 이벤트 바인딩 ───
function init() {
  preloadSfx();
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('touchstart', unlockAudio, { once: true, passive: true });

  $('#field-korean').addEventListener('change', updateFieldVisibility);
  $('#field-english').addEventListener('change', updateFieldVisibility);
  $('#field-example').addEventListener('change', updateFieldVisibility);

  $('#timer-enabled').addEventListener('change', () => {
    timerEnabled = $('#timer-enabled').checked;
    $('#timer-input-group').hidden = !timerEnabled;
  });

  $('#timer-seconds').addEventListener('change', () => {
    timerSeconds = parseInt($('#timer-seconds').value, 10) || 120;
  });

  $('#btn-add-word').addEventListener('click', addWord);

  ['input-word', 'input-korean', 'input-english', 'input-example'].forEach((id) => {
    $(`#${id}`).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWord();
    });
  });

  $('#btn-clear-words').addEventListener('click', () => {
    if (words.length === 0) return;
    if (confirm('모든 단어를 삭제할까요?')) {
      words = [];
      renderWordList();
    }
  });

  $('#btn-save-preset').addEventListener('click', savePreset);
  $('#btn-start').addEventListener('click', () => {
    unlockAudio();
    warmSpeechInGesture();
    startGame(false);
  });

  $('#btn-spelling-reset').addEventListener('click', resetSpellingSelection);

  $('#btn-retry-wrong').addEventListener('click', retryWrongWords);
  $('#btn-restart').addEventListener('click', restartGame);
  $('#btn-back-setup').addEventListener('click', resetToSetup);
  $('#btn-header-home').addEventListener('click', goHomeFromGame);

  updateFieldVisibility();
  renderPresets();
  loadBuiltInManifest();
}

document.addEventListener('DOMContentLoaded', init);
