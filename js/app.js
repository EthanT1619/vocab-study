/* 단어 시험 준비 - 모바일版 */

const STORAGE_KEY = 'vocab-study-mobile-presets';

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

const MAX_PAIRS_PER_BATCH = 4;
let matchCards = [];
let pairQueue = [];
let selectedCard = null;
let batchMatchedCount = 0;
let currentBatchSize = 0;
let completedPairs = 0;
let totalPairs = 0;

let quizQueue = [];
let currentQuiz = null;

let spellingQueue = [];
let spellingTotal = 0;
let currentSpelling = null;
let spellingHintField = null;
let shuffledLetters = [];
let selectedLetters = [];
let usedLetterBtns = new Set();

let phaseSetup, phaseRound, phaseResult;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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
  return { cols, rows: Math.ceil(count / cols) };
}

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

function showFormFeedback(msg, type = 'error') {
  const el = $('#form-feedback');
  if (!el) return;
  el.textContent = msg;
  el.className = `form-feedback ${type}`;
  el.hidden = false;
}

function hideFormFeedback() {
  const el = $('#form-feedback');
  if (el) el.hidden = true;
}

function notify(msg, type = 'info') {
  showToast(msg, type);
  if (type === 'error') showFormFeedback(msg, 'error');
  else if (type === 'success') showFormFeedback(msg, 'success');
  else hideFormFeedback();
}

function showToast(msg, type = 'info') {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 2400);
}

function showPhase(phase) {
  [phaseSetup, phaseRound, phaseResult].forEach((el) => el.classList.remove('active'));
  phase.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function recordCorrect() {
  correctCount++;
  addScore(10);
  updateStats(null, null);
}

function recordWrong(wordId) {
  wrongCount++;
  wrongWordIds.add(wordId);
  updateStats(null, null);
}

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

function updateFieldVisibility() {
  fields.korean = $('#field-korean').checked;
  fields.english = $('#field-english').checked;
  fields.example = $('#field-example').checked;
  $$('[data-field]').forEach((el) => {
    el.hidden = !fields[el.dataset.field];
  });
}

function validateFields() {
  const active = getActiveFields();
  if (active.length === 0) {
    notify('한글 뜻, 영어 뜻, 예시문장 중 하나 이상을 선택해주세요.', 'error');
    return false;
  }
  return true;
}

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
    notify('영어 단어를 입력해주세요.', 'error');
    $('#input-word').focus();
    return;
  }

  const active = getActiveFields();
  for (const f of active) {
    const val = { korean, english, example }[f];
    if (!val) {
      notify(`${FIELD_LABELS[f]}을(를) 입력해주세요.`, 'error');
      return;
    }
  }

  words.push({ id: generateId(), word, korean, english, example });
  renderWordList();

  $('#input-word').value = '';
  $('#input-korean').value = '';
  $('#input-english').value = '';
  $('#input-example').value = '';
  hideFormFeedback();
  showToast('단어가 추가되었습니다.', 'success');
}

function getPresets() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
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

  container.innerHTML = names.map((name, i) => {
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
          <button type="button" class="btn btn-secondary btn-small" data-preset-idx="${i}">불러오기</button>
          <button type="button" class="btn btn-text btn-danger-text btn-small" data-preset-del="${i}">삭제</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('[data-preset-idx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = names[parseInt(btn.dataset.presetIdx, 10)];
      loadPreset(name);
    });
  });
  container.querySelectorAll('[data-preset-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const name = names[parseInt(btn.dataset.presetDel, 10)];
      deletePreset(name);
    });
  });
}

function savePreset() {
  const name = $('#preset-name').value.trim();
  if (!name) {
    notify('프리셋 이름을 입력해주세요.', 'error');
    return;
  }
  if (words.length === 0) {
    notify('저장할 단어가 없습니다.', 'error');
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

  fields = { ...p.fields };
  words = p.words.map((w) => ({ ...w }));
  timerEnabled = p.timerEnabled || false;
  timerSeconds = p.timerSeconds || 120;

  $('#field-korean').checked = fields.korean;
  $('#field-english').checked = fields.english;
  $('#field-example').checked = fields.example;
  $('#timer-enabled').checked = timerEnabled;
  $('#timer-seconds').value = timerSeconds;
  $('#timer-input-group').hidden = !timerEnabled;
  $('#preset-name').value = name;

  updateFieldVisibility();
  renderWordList();
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

function startGame(retryOnly = false) {
  if (!validateFields()) return;
  if (words.length === 0) {
    notify('단어를 먼저 추가해주세요.', 'error');
    return;
  }

  isRetryMode = retryOnly;
  gameWords = retryOnly ? words.filter((w) => wrongWordIds.has(w.id)) : [...words];

  if (gameWords.length === 0) {
    showToast('복습할 틀린 단어가 없습니다.', 'info');
    return;
  }

  score = 0;
  correctCount = 0;
  wrongCount = 0;
  if (!retryOnly) wrongWordIds = new Set();

  currentRound = 1;
  showPhase(phaseRound);
  startRound1();
}

function resetToSetup() {
  stopTimer();
  showPhase(phaseSetup);
  isRetryMode = false;
}

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
  grid.style.gridTemplateColumns = 'repeat(2, 1fr)';

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
      id: generateId(), wordId: pair.wordId, type: 'word',
      text: pair.wordText, pairKey: pair.pairKey,
    });
    matchCards.push({
      id: generateId(), wordId: pair.wordId, type: pair.field,
      text: pair.meaningText, pairKey: pair.pairKey,
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

  const card = matchCards.find((c) => c.id === el.dataset.id);
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

  const isMatch =
    first.card.pairKey === card.pairKey &&
    first.card.type !== card.type &&
    ((first.card.type === 'word' && card.type !== 'word') ||
     (card.type === 'word' && first.card.type !== 'word'));

  if (isMatch) {
    first.el.classList.add('matched');
    el.classList.add('matched');
    batchMatchedCount++;
    completedPairs++;
    recordCorrect();
    updateStats(completedPairs, totalPairs);
    showToast('정답!', 'success');

    if (batchMatchedCount >= currentBatchSize) {
      if (pairQueue.length === 0) setTimeout(finishRound1, 600);
      else {
        showToast('다음 카드 세트!', 'info');
        setTimeout(loadNextMatchBatch, 700);
      }
    }
  } else {
    recordWrong(first.card.wordId);
    showToast('틀렸어요. 다시 시도해보세요.', 'error');
  }
}

function finishRound1() {
  stopTimer();
  currentRound = 2;
  startRound2();
}

function startRound2() {
  const info = ROUND_INFO[1];
  $('#round-label').textContent = info.label;
  $('#round-title').textContent = info.title;
  $('#round1-content').hidden = true;
  $('#round2-content').hidden = false;
  $('#round3-content').hidden = true;

  const active = getActiveFields();
  quizQueue = shuffle(
    gameWords.map((w) => ({
      word: w,
      field: active[Math.floor(Math.random() * active.length)],
    }))
  );

  updateStats(0, quizQueue.length);
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

  const container = $('#quiz-choices');
  container.innerHTML = shuffle(choices).map((c) => `
    <button type="button" class="quiz-choice" data-correct="${c.correct}">
      ${escapeHtml(c.word)}
    </button>
  `).join('');

  container.querySelectorAll('.quiz-choice').forEach((btn) => {
    btn.addEventListener('click', () => onQuizChoice(btn));
  });

  updateStats(gameWords.length - quizQueue.length - 1, gameWords.length);
}

function onQuizChoice(btn) {
  if (btn.classList.contains('disabled')) return;

  const isCorrect = btn.dataset.correct === 'true';
  $$('.quiz-choice').forEach((b) => {
    b.classList.add('disabled');
    if (b.dataset.correct === 'true') b.classList.add('correct');
    else if (b === btn && !isCorrect) b.classList.add('wrong');
  });

  if (isCorrect) {
    recordCorrect();
    showToast('정답!', 'success');
  } else {
    recordWrong(currentQuiz.word.id);
    showToast(`오답! 정답: ${currentQuiz.word.word}`, 'error');
  }

  setTimeout(showNextQuiz, 900);
}

function finishRound2() {
  stopTimer();
  currentRound = 3;
  startRound3();
}

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
  updateStats(spellingTotal - spellingQueue.length - 1, spellingTotal);
}

function renderSpelling(reshuffle = true) {
  const w = currentSpelling.wordEntry;
  const target = currentSpelling.spellingText;
  const hintText = w[spellingHintField] || '';

  let hintHtml = hintText
    ? `<strong>${FIELD_LABELS[spellingHintField]}</strong>: ${escapeHtml(hintText)}`
    : '글자를 순서대로 눌러 단어를 완성하세요.';

  if (currentSpelling.partTotal > 1) {
    hintHtml += `<br><span class="spelling-part-label">${currentSpelling.partIndex + 1} / ${currentSpelling.partTotal}</span>`;
  }

  $('#spelling-hint').innerHTML = hintHtml;
  renderSpellingSlots();

  if (reshuffle) {
    shuffledLetters = shuffle(target.split(''));
    selectedLetters = [];
    usedLetterBtns = new Set();
  }

  const letters = target.split('');
  $('#spelling-letters').innerHTML = shuffledLetters.map((ch, i) =>
    `<button type="button" class="spelling-letter ${usedLetterBtns.has(i) ? 'used' : ''}" data-char="${ch}" data-idx="${i}">${escapeHtml(ch)}</button>`
  ).join('');

  $('#spelling-letters').querySelectorAll('.spelling-letter').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('used')) return;
      selectedLetters.push(btn.dataset.char);
      usedLetterBtns.add(parseInt(btn.dataset.idx, 10));
      btn.classList.add('used');
      renderSpellingSlots();
      if (selectedLetters.length === letters.length) checkSpelling();
    });
  });
}

function renderSpellingSlots() {
  const letters = currentSpelling.spellingText.split('');
  $('#spelling-answer').innerHTML = letters.map((_, i) =>
    `<div class="spelling-slot ${selectedLetters[i] ? 'filled' : ''}">${escapeHtml(selectedLetters[i] || '')}</div>`
  ).join('');
}

function checkSpelling() {
  const answer = selectedLetters.join('');
  const correct = currentSpelling.spellingText;

  if (answer.toLowerCase() === correct.toLowerCase()) {
    recordCorrect();
    showToast('정답!', 'success');
    setTimeout(showNextSpelling, 800);
  } else {
    recordWrong(currentSpelling.wordEntry.id);
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
  const retryBtn = $('#btn-retry-wrong');

  if (wrongWordIds.size > 0) {
    wrongSection.hidden = false;
    retryBtn.hidden = false;
    $('#wrong-words-list').innerHTML = words
      .filter((w) => wrongWordIds.has(w.id))
      .map((w) => `<li>${escapeHtml(w.word)}</li>`)
      .join('');
  } else {
    wrongSection.hidden = true;
    retryBtn.hidden = true;
  }
}

function init() {
  phaseSetup = $('#phase-setup');
  phaseRound = $('#phase-round');
  phaseResult = $('#phase-result');

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
    const el = $(`#${id}`);
    if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') addWord(); });
  });

  $('#btn-clear-words').addEventListener('click', () => {
    if (words.length === 0) return;
    if (confirm('모든 단어를 삭제할까요?')) {
      words = [];
      renderWordList();
    }
  });

  $('#btn-save-preset').addEventListener('click', savePreset);
  $('#btn-start').addEventListener('click', () => startGame(false));
  $('#btn-spelling-reset').addEventListener('click', resetSpellingSelection);
  $('#btn-retry-wrong').addEventListener('click', () => startGame(true));
  $('#btn-restart').addEventListener('click', () => startGame(false));
  $('#btn-back-setup').addEventListener('click', resetToSetup);

  updateFieldVisibility();
  renderPresets();
}

document.addEventListener('DOMContentLoaded', init);
