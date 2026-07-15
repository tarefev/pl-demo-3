/**
 * Демо-логика: рендер блоков документа, лента ассистента,
 * проигрывание сценариев из js/scenarios.js.
 */

const $ = (sel, root = document) => root.querySelector(sel);

const docBlocksEl = $('#doc-blocks');
const feedEl = $('#assistant-feed');
const assistantScrollEl = $('#assistant-scroll');
const contextEl = $('#input-context');
const promptEl = $('#prompt-input');

let activeBlockId = null;

/* ================= Документ ================= */

function renderBlocks() {
  docBlocksEl.innerHTML = '';
  DOC_BLOCKS.forEach(block => {
    const el = document.createElement('div');
    el.className = 'doc-block';
    el.dataset.blockId = block.id;
    el.contentEditable = 'true';
    el.innerHTML = `
      <span class="doc-block__label" contenteditable="false">${block.label}</span>
      <button class="doc-block__status ${block.status === 'done' ? 'is-done' : ''}"
              contenteditable="false" title="Статус блока" tabindex="-1"></button>
      ${block.html}`;
    el.addEventListener('focusin', () => setActiveBlock(block.id));
    el.addEventListener('click', () => setActiveBlock(block.id));
    docBlocksEl.appendChild(el);
  });
}

function setActiveBlock(id) {
  if (activeBlockId === id) return;
  activeBlockId = id;
  document.querySelectorAll('.doc-block').forEach(el =>
    el.classList.toggle('is-active', el.dataset.blockId === id));
  renderContextChip();
}

function setBlockStatus(id, status) {
  const el = document.querySelector(`.doc-block[data-block-id="${id}"] .doc-block__status`);
  if (el) el.classList.toggle('is-done', status === 'done');
  const block = DOC_BLOCKS.find(b => b.id === id);
  if (block) block.status = status;
}

/* ================= Чип контекста во вводе ================= */

function renderContextChip() {
  contextEl.innerHTML = '';
  if (!activeBlockId) return;
  const block = DOC_BLOCKS.find(b => b.id === activeBlockId);
  if (!block) return;

  const chip = document.createElement('span');
  chip.className = 'context-chip';
  chip.innerHTML = `${block.label}
    <button title="Отвязать блок">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </button>`;
  chip.querySelector('button').addEventListener('click', () => {
    activeBlockId = null;
    document.querySelectorAll('.doc-block').forEach(el => el.classList.remove('is-active'));
    renderContextChip();
  });
  contextEl.appendChild(chip);
}

/* ================= Лента ассистента ================= */

function scrollFeed() {
  assistantScrollEl.scrollTop = assistantScrollEl.scrollHeight;
}

function addMessage(kind, text) {
  const el = document.createElement('div');
  el.className = `msg msg--${kind}`;
  el.textContent = text;
  feedEl.appendChild(el);
  scrollFeed();
  return el;
}

function addThinking(text) {
  const el = document.createElement('div');
  el.className = 'msg msg--thinking';
  el.innerHTML = `${text}<span class="dots"></span>`;
  feedEl.appendChild(el);
  scrollFeed();
  return el;
}

function addChips(preset) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';

  if (preset === 'defense-lines') {
    DEFENSE_LINES.forEach(line => {
      const btn = document.createElement('button');
      btn.className = 'chip' + (line.wide ? ' chip--wide' : '');
      btn.innerHTML = `<span>${line.title}</span>
        <svg class="chip__arrow" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      btn.addEventListener('click', () => {
        addMessage('user', line.title);
        playScenario('line-selected');
      });
      wrap.appendChild(btn);
    });

    wrap.appendChild(makeChip('Создать новую линию', () => {
      addMessage('user', 'Создать новую линию');
      playScenario('new-line');
    }, 'chip--ghost'));

    wrap.appendChild(makeChip('Оставить свободным', () => {
      addMessage('user', 'Оставить свободным');
      playScenario('keep-free');
    }, 'chip--ghost'));
  }

  if (preset === 'confirm-line') {
    wrap.appendChild(makeChip('Применить к блоку', () => {
      addMessage('user', 'Применить к блоку');
      playScenario('line-selected');
    }));
    wrap.appendChild(makeChip('Отмена', () => {
      addMessage('user', 'Отмена');
      playScenario('keep-free');
    }, 'chip--ghost'));
  }

  feedEl.appendChild(wrap);
  scrollFeed();
}

function makeChip(text, onClick, extraClass = '') {
  const btn = document.createElement('button');
  btn.className = `chip ${extraClass}`.trim();
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}

/* ================= Проигрывание сценариев ================= */

async function playScenario(key) {
  const steps = SCENARIOS[key];
  if (!steps) return;

  for (const step of steps) {
    switch (step.type) {
      case 'thinking': {
        const el = addThinking(step.text);
        await sleep(step.delay || 1200);
        el.remove();
        break;
      }
      case 'assistant':
        addMessage('assistant', step.text);
        break;
      case 'chips':
        addChips(step.preset);
        break;
      case 'block-status':
        if (activeBlockId) setBlockStatus(activeBlockId, step.status);
        break;
    }
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= Ввод ================= */

function sendPrompt() {
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = '';
  autosize();
  addMessage('user', text);
  playScenario('free-prompt');
}

function autosize() {
  promptEl.style.height = 'auto';
  promptEl.style.height = Math.min(promptEl.scrollHeight, 120) + 'px';
}

promptEl.addEventListener('input', autosize);
promptEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendPrompt();
  }
});
$('#btn-send').addEventListener('click', sendPrompt);

/* ================= Шапка ================= */

$('#btn-download').addEventListener('click', () => window.print());
$('#btn-print').addEventListener('click', () => window.print());
$('#btn-logs').addEventListener('click', e => e.preventDefault());

/* ================= Старт ================= */

renderBlocks();
setActiveBlock('block-2');
playScenario('start');
