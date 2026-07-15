/**
 * Демо-движок чата по каркасу:
 *  - состояния: сценарий не запущен (C) / сценарий предложил чоисы (B.1) /
 *    сценарий ждёт текст (B.2) / идёт генерация (D, ввод заблокирован);
 *  - перебивка: новый сценарий (командой из чата или файлом) поверх активного —
 *    вопрос «прервать?»; старый завершается, стейт обнуляется, действия не откатываются;
 *  - сценарии: привязка линии (№2), создание линии (№6), проверка документа (№15),
 *    генерация по линиям (№17), справка (№14), разбор DOCX (№3 — по скрепке).
 */

const $ = (sel, root = document) => root.querySelector(sel);

const switcherTabsEl = $('#demo-switcher-tabs');
const docBlocksEl = $('#doc-blocks');
const feedEl = $('#assistant-feed');
const assistantScrollEl = $('#assistant-scroll');
const caseCardEl = $('#case-card');
const contextEl = $('#input-context');
const promptEl = $('#prompt-input');
const sendBtn = $('#btn-send');
const attachBtn = $('#btn-attach');

/* ================= Состояние ================= */

const state = {
  tabIndex: 0,
  card: null,          // рабочая копия карточки дела
  blocks: null,        // рабочая копия блоков документа
  boundLines: null,    // Set id линий, уже привязанных к блокам
  activeBlockId: null,
  scenario: null,      // { id, title, stage: 'choices'|'text', chipsSpec, chipsEl, onText, reaskText }
  busy: false
};

const clone = obj => JSON.parse(JSON.stringify(obj));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ================= Переключатель раскладов ================= */

function renderSwitcher() {
  switcherTabsEl.innerHTML = '';
  DEMO_TABS.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'demo-tab' + (i === state.tabIndex ? ' is-active' : '');
    btn.textContent = tab.tab;
    btn.title = tab.hint;
    btn.addEventListener('click', () => resetDemo(i));
    switcherTabsEl.appendChild(btn);
  });
}

/** Полный сброс контекста под выбранный таб. */
function resetDemo(tabIndex) {
  const tab = DEMO_TABS[tabIndex];
  state.tabIndex = tabIndex;
  state.card = clone(tab.card);
  state.blocks = clone(DOC_BLOCKS);
  state.boundLines = new Set();
  state.activeBlockId = null;
  state.scenario = null;
  state.busy = false;

  feedEl.innerHTML = '';
  promptEl.value = '';
  autosize();
  setBusy(false);

  renderSwitcher();
  renderBlocks();
  renderCaseCard();
  setActiveBlock('block-2');

  if (tab.demoNote) addMessage('demo', tab.demoNote);
  if (tab.autostart === 'bind-line') startBindLine();
}

/* ================= Документ ================= */

function renderBlocks() {
  docBlocksEl.innerHTML = '';
  state.blocks.forEach(block => {
    const el = document.createElement('div');
    el.className = 'doc-block' + (block.id === state.activeBlockId ? ' is-active' : '');
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
  if (state.activeBlockId === id) return;
  state.activeBlockId = id;
  document.querySelectorAll('.doc-block').forEach(el =>
    el.classList.toggle('is-active', el.dataset.blockId === id));
  renderContextChip();
}

function getBlock(id) {
  return state.blocks.find(b => b.id === id);
}

/** Заменяет текст блока, ставит ✓ и подсвечивает. */
function regenerateBlock(id, newText) {
  const block = getBlock(id);
  if (!block) return;
  block.html = newText;
  block.status = 'done';
  renderBlocks();
  flashBlock(id);
}

/** Вставляет новый блок (после activeBlock или в конец), возвращает его id. */
function insertBlock(text, { afterId } = {}) {
  const n = state.blocks.length + 1;
  const block = {
    id: `block-new-${n}`,
    label: `Блок ${n}`,
    status: 'done',
    html: text
  };
  const idx = afterId ? state.blocks.findIndex(b => b.id === afterId) : -1;
  if (idx >= 0) state.blocks.splice(idx + 1, 0, block);
  else state.blocks.push(block);
  // перенумеровываем метки по порядку
  state.blocks.forEach((b, i) => { b.label = `Блок ${i + 1}`; });
  renderBlocks();
  flashBlock(block.id);
  return block.id;
}

function flashBlock(id) {
  const el = document.querySelector(`.doc-block[data-block-id="${id}"]`);
  if (!el) return;
  el.classList.add('flash');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.classList.remove('flash'), 1600);
}

/* ================= Карточка дела ================= */

function renderCaseCard(highlightSel) {
  const c = state.card;
  const filled = c.advocate || c.client || c.episodes.length ||
    c.lines.length || c.circumstances.length || c.evidence.length;

  if (!filled) {
    caseCardEl.innerHTML = `
      <div class="case-card case-card--empty">
        <div class="case-card__title">Карточка дела</div>
        <div class="case-card__placeholder">Карточка дела не заполнена</div>
      </div>`;
    return;
  }

  const section = (title, itemsHtml, cls = '') => itemsHtml ? `
    <div class="case-card__section ${cls}">
      ${title ? `<div class="case-card__section-title">${title}</div>` : ''}
      ${itemsHtml}
    </div>` : '';

  const persons = [
    c.advocate ? `<div class="case-card__row"><span>Адвокат</span>${c.advocate}</div>` : '',
    c.client ? `<div class="case-card__row"><span>Доверитель</span>${c.client}</div>` : ''
  ].join('');

  const episodes = c.episodes.map(ep => `
    <div class="case-card__episode" data-id="${ep.id}">
      <div class="case-card__episode-title">${ep.title}</div>
      <div class="case-card__episode-text">${ep.text}</div>
    </div>`).join('');

  const lines = c.lines.map(l => `
    <div class="case-card__line" data-id="${l.id}">
      <div class="case-card__line-title">${l.title}</div>
      ${l.thesis ? `<div class="case-card__line-thesis">${l.thesis}</div>` : ''}
    </div>`).join('');

  const list = arr => arr.length
    ? `<ul class="case-card__list">${arr.map(i => `<li>${i}</li>`).join('')}</ul>` : '';

  caseCardEl.innerHTML = `
    <div class="case-card">
      <div class="case-card__title">Карточка дела</div>
      ${section('', persons)}
      ${section(`Фабула · ${c.episodes.length} эп.`, episodes)}
      ${section(`Линии защиты · ${c.lines.length}`, lines)}
      ${section('Обстоятельства', list(c.circumstances))}
      ${section('Доказательства', list(c.evidence))}
    </div>`;

  if (highlightSel) {
    const el = caseCardEl.querySelector(highlightSel);
    if (el) {
      el.classList.add('flash');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
  }
}

/* ================= Чип контекста во вводе ================= */

function renderContextChip() {
  contextEl.innerHTML = '';
  if (!state.activeBlockId) return;
  const block = getBlock(state.activeBlockId);
  if (!block) return;

  const chip = document.createElement('span');
  chip.className = 'context-chip';
  // пока идёт сценарий — пилз блока без крестика
  chip.innerHTML = state.scenario ? block.label : `${block.label}
    <button title="Отвязать блок">
      <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  const closeBtn = chip.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    state.activeBlockId = null;
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

/** Сообщение-файл от пользователя. */
function addFileMessage(fileName) {
  const el = document.createElement('div');
  el.className = 'msg msg--user msg--file';
  el.innerHTML = `<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>${fileName}`;
  feedEl.appendChild(el);
  scrollFeed();
}

/** «Генерация» (состояние D): блокирует ввод и чипы. */
async function think(text, ms = 1400) {
  setBusy(true);
  const el = document.createElement('div');
  el.className = 'msg msg--thinking';
  el.innerHTML = `${text}<span class="dots"></span>`;
  feedEl.appendChild(el);
  scrollFeed();
  await sleep(ms);
  el.remove();
  setBusy(false);
}

function setBusy(busy) {
  state.busy = busy;
  promptEl.disabled = busy;
  sendBtn.disabled = busy;
  feedEl.classList.toggle('is-busy', busy);
}

/* ================= Движок сценариев ================= */

function startScenario(id, title) {
  state.scenario = { id, title, stage: null, chipsSpec: null, chipsEl: null, onText: null, reaskText: null };
  renderContextChip();
}

function endScenario(finalText) {
  if (finalText) addMessage('assistant', finalText);
  state.scenario = null;
  renderContextChip();
}

/**
 * Группа чипов. options: [{label, sub, wide, ghost, episode, onPick}]
 * После выбора группа замораживается, выбранный чип подсвечивается.
 */
function addChips(options) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';

  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'chip'
      + (opt.wide ? ' chip--wide' : '')
      + (opt.ghost ? ' chip--ghost' : '')
      + (opt.episode ? ' chip--episode' : '');
    btn.innerHTML = `<span>${opt.label}${opt.sub ? `<small class="chip__sub">${opt.sub}</small>` : ''}</span>`;
    btn.addEventListener('click', () => {
      if (state.busy || wrap.classList.contains('is-answered')) return;
      wrap.classList.add('is-answered');
      btn.classList.add('is-chosen');
      opt.onPick();
    });
    wrap.appendChild(btn);
  });

  feedEl.appendChild(wrap);
  scrollFeed();
  return wrap;
}

/** Чоисы в рамках сценария (B.1): запоминаем для перебивки и повторного показа. */
function offerChoices(options, intro) {
  if (intro) addMessage('assistant', intro);
  if (state.scenario) {
    state.scenario.stage = 'choices';
    state.scenario.chipsSpec = options;
    state.scenario.onText = null;
    state.scenario.chipsEl = addChips(options);
    return state.scenario.chipsEl;
  }
  return addChips(options);
}

/** Ожидание текстового ввода в рамках сценария (B.2). */
function awaitText(promptText, handler) {
  if (promptText) addMessage('assistant', promptText);
  state.scenario.stage = 'text';
  state.scenario.chipsSpec = null;
  state.scenario.chipsEl = null;
  state.scenario.onText = handler;
  state.scenario.reaskText = promptText;
}

/* ---------- Роутинг свободного ввода ---------- */

const normalize = s => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

function matchTrigger(text) {
  return SCENARIO_TRIGGERS.find(t => t.re.test(text)) || null;
}

/** «Если есть пилз с таким текстом — выбираем пилз». */
function matchChipButton(text) {
  const sc = state.scenario;
  if (!sc || !sc.chipsEl || sc.chipsEl.classList.contains('is-answered')) return null;
  const q = normalize(text);
  if (q.length < 3) return null;
  return [...sc.chipsEl.querySelectorAll('.chip')].find(btn => {
    const label = normalize(btn.textContent);
    return label.includes(q) || q.includes(label);
  }) || null;
}

function launchScenario(trigger) {
  switch (trigger.id) {
    case 'bind-line': startBindLine(); break;
    case 'create-line': startCreateLine(); break;
    case 'check-doc': startCheckDoc(); break;
    case 'gen-by-lines': startGenByLines(); break;
    case 'help': startHelp(); break;
  }
}

/** Вопрос «прервать сценарий?» (правила B.1.1 / B.1.4 каркаса). */
function askInterrupt(actionTitle, onConfirm) {
  const sc = state.scenario;
  const savedSpec = sc.chipsSpec;
  const savedStage = sc.stage;
  const savedOnText = sc.onText;
  const savedReask = sc.reaskText;

  const resume = () => {
    if (savedStage === 'choices' && savedSpec) {
      offerChoices(savedSpec, 'Продолжаем. Выберите один из вариантов:');
    } else if (savedStage === 'text') {
      sc.stage = 'text';
      sc.onText = savedOnText;
      if (savedReask) addMessage('assistant', savedReask);
    }
  };

  offerChoices([
    {
      label: 'Прервать сценарий',
      onPick: () => {
        addMessage('user', 'Прервать сценарий');
        const old = state.scenario;
        state.scenario = null;
        renderContextChip();
        addMessage('assistant', `Сценарий «${old.title}» прерван. Уже выполненные действия не откатываются.`);
        onConfirm();
      }
    },
    {
      label: 'Продолжить текущий',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Продолжить текущий');
        resume();
      }
    }
  ], `Сейчас идёт сценарий «${sc.title}». Прервать его и выполнить «${actionTitle}»?`);
}

/** Текст не подходит под контекст ожидания (B.2.3.2): ответ / переформулировать / новый вопрос. */
function askTextMismatch(text, trigger) {
  const sc = state.scenario;
  const savedOnText = sc.onText;
  const savedReask = sc.reaskText;

  offerChoices([
    {
      label: 'Это был ответ',
      onPick: () => {
        addMessage('user', 'Это был ответ');
        sc.stage = 'text';
        savedOnText(text);
      }
    },
    {
      label: 'Переформулирую',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Переформулирую');
        awaitText(savedReask || 'Слушаю.', savedOnText);
      }
    },
    {
      label: 'Это новый вопрос',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Это новый вопрос');
        const old = state.scenario;
        state.scenario = null;
        renderContextChip();
        addMessage('assistant', `Сценарий «${old.title}» завершён.`);
        launchScenario(trigger);
      }
    }
  ], 'Похоже, это не ответ на мой вопрос. Это был ответ, переформулируете или это новый вопрос?');
}

async function routeText(text) {
  const trigger = matchTrigger(text);
  const sc = state.scenario;

  // Сценарий не запущен (состояние C)
  if (!sc) {
    if (trigger) return launchScenario(trigger);
    return onFreeInput(text);
  }

  // B.1: предложены чоисы
  if (sc.stage === 'choices') {
    const chipBtn = matchChipButton(text);
    if (chipBtn) return chipBtn.click();
    if (trigger) return askInterrupt(trigger.title, () => launchScenario(trigger));
    addMessage('assistant', 'Выберите, пожалуйста, один из предложенных вариантов. Если хотите другое действие — введите команду, и я предложу прервать сценарий.');
    if (sc.chipsSpec) offerChoices(sc.chipsSpec);
    return;
  }

  // B.2: ждём текстовый ввод
  if (sc.stage === 'text') {
    if (trigger) return askTextMismatch(text, trigger);
    const handler = sc.onText;
    sc.onText = null;
    return handler(text);
  }
}

async function onFreeInput(text) {
  await think('Обрабатываю запрос', 1400);
  addMessage('assistant', '(Демо) Свободный ввод вне сценариев отвечает заглушкой. Наберите «справка» — покажу доступные команды.');
}

/* ================= Сценарий №2: привязка линии защиты к блоку ================= */

function startBindLine() {
  startScenario('bind-line', 'Привязка линии защиты к блоку');

  // 2.1 Блок известен?
  if (!state.activeBlockId) {
    endScenario('Блок не выбран. Кликните на нужный блок в документе и вызовите привязку линии ещё раз.');
    return;
  }

  // 2.2 Эпизоды
  if (!state.card.episodes.length) {
    awaitText(
      'Карточка дела не заполнена: эпизодов фабулы нет. Введите краткую фабулу своими словами прямо в чат либо приложите DOCX с приговором или постановлением о возбуждении дела (скрепка внизу).',
      onFabulaEntered
    );
    return;
  }

  if (state.card.episodes.length === 1) {
    onEpisodeChosen(state.card.episodes[0], { silent: true });
  } else {
    offerChoices(
      state.card.episodes.map(ep => ({
        label: ep.title,
        sub: ep.text,
        wide: true,
        episode: true,
        onPick: () => {
          addMessage('user', ep.title);
          onEpisodeChosen(ep);
        }
      })),
      'К какому эпизоду относится этот блок? Выберите эпизод.'
    );
  }
}

/** 2.2.1.1.1 — фабула введена текстом: распознаём и сохраняем эпизод. */
async function onFabulaEntered(text) {
  await think('Распознаю фабулу', 2000);

  const episode = {
    id: 'ep-user-1',
    title: 'Эпизод 1 — из введённой фабулы',
    text: text
  };
  state.card.episodes.push(episode);
  renderCaseCard(`.case-card__episode[data-id="${episode.id}"]`);

  addMessage('assistant', 'Фабула распознана и сохранена в карточку дела.');
  onEpisodeChosen(episode, { silent: true });
}

/** 2.3 — эпизод известен, смотрим линии. */
function onEpisodeChosen(episode, { silent } = {}) {
  const lines = state.card.lines.filter(l => !l.episodeId || l.episodeId === episode.id);

  if (!lines.length) {
    addMessage('assistant',
      (silent ? `Эпизод определён: ${episode.title}. ` : '') +
      'Для данного эпизода ещё нет линий защиты. Создайте новую линию.');
    offerCreateLine(episode);
    return;
  }

  offerChoices([
    ...lines.map(line => ({
      label: line.title,
      wide: true,
      onPick: () => {
        addMessage('user', line.title);
        onLineChosen(line, episode);
      }
    })),
    { label: 'Создать новую линию', ghost: true, onPick: () => { addMessage('user', 'Создать новую линию'); offerCreateLine(episode, { skipIntro: true }); } },
    { label: 'Оставить свободным', ghost: true, onPick: () => { addMessage('user', 'Оставить свободным'); endScenario('Блок оставлен свободным — вернуться к выбору линии можно в любой момент.'); } }
  ], 'Выберите линию защиты для этого блока, создайте новую или оставьте блок свободным.');
}

/** 2.3.х — способ создания линии. */
function offerCreateLine(episode, { skipIntro } = {}) {
  offerChoices([
    { label: 'Подобрать по практике', onPick: () => { addMessage('user', 'Подобрать по практике'); offerPracticeLines(episode, 0); } },
    { label: 'Написать тезис своими словами', onPick: () => { addMessage('user', 'Своими словами'); askThesis(episode); } }
  ], skipIntro ? null : 'Как создать линию защиты?');
}

/** Пилзы линий из практики с пагинацией «Показать еще». */
function offerPracticeLines(episode, offset) {
  const page = PRACTICE_LINES.slice(offset, offset + PRACTICE_PAGE_SIZE);
  const hasMore = offset + PRACTICE_PAGE_SIZE < PRACTICE_LINES.length;

  offerChoices([
    ...page.map(p => ({
      label: p.title,
      sub: `${p.cases} дел в практике`,
      wide: true,
      onPick: () => {
        addMessage('user', p.title);
        createLine(episode, p.title, null);
      }
    })),
    ...(hasMore ? [{ label: 'Показать еще', ghost: true, onPick: () => offerPracticeLines(episode, offset + PRACTICE_PAGE_SIZE) }] : [])
  ], offset === 0 ? 'Линии защиты с наиболее объёмной практикой:' : null);
}

/** Ждём тезис свободным вводом (B.2). */
function askThesis(episode) {
  awaitText('Введите тезис защиты своими словами.', text => onThesisEntered(episode, text));
}

/** «Нейронка» угадывает 3 линии по тезису. */
async function onThesisEntered(episode, thesis) {
  await think('Подбираю подходящие линии защиты', 1600);
  offerChoices([
    ...GUESSED_LINES.map(title => ({
      label: title,
      wide: true,
      onPick: () => {
        addMessage('user', title);
        createLine(episode, title, thesis);
      }
    })),
    {
      label: 'Не устроил ни один из вариантов',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Не устроил ни один из вариантов');
        createLine(episode, null, thesis);
      }
    }
  ], 'Похоже на одну из этих линий — выберите подходящую:');
}

/** Создание линии + привязка. */
async function createLine(episode, title, thesis) {
  await think('Создаю линию защиты', 1500);

  const line = {
    id: `line-new-${state.card.lines.length + 1}`,
    episodeId: episode ? episode.id : null,
    title: title || 'Новая линия защиты (без названия)',
    thesis: thesis || 'Тезис сформирован автоматически по материалам практики.',
    generatedText: REGEN_FALLBACK_TEXT
  };
  state.card.lines.push(line);
  renderCaseCard(`.case-card__line[data-id="${line.id}"]`);

  onLineChosen(line, episode, { created: true });
}

/** 2.4 — линия привязана, предлагаем перегенерацию блока. */
async function onLineChosen(line, episode, { created } = {}) {
  if (!created) await think('Привязываю линию к блоку', 1200);

  state.boundLines.add(line.id);
  const blockLabel = getBlock(state.activeBlockId)?.label || 'блоку';

  offerChoices([
    {
      label: 'Перегенерировать блок',
      onPick: async () => {
        addMessage('user', 'Перегенерировать блок');
        await think('Генерирую новый текст блока', 2000);
        regenerateBlock(state.activeBlockId, line.generatedText || REGEN_FALLBACK_TEXT);
        endScenario('Текст блока обновлён, просительная часть пересобрана с учётом линии защиты.');
      }
    },
    {
      label: 'Не перегенерировать',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Не перегенерировать');
        endScenario('Готово: линия привязана к блоку. Текст блока оставлен без изменений.');
      }
    }
  ], `${created ? 'Линия создана. ' : ''}Линия привязана к ${blockLabel}, эпизод — к линии. Перегенерировать текст блока с учётом привязанной информации?`);
}

/* ================= Сценарий №6: создание линии защиты ================= */

function startCreateLine() {
  startScenario('create-line', 'Создание линии защиты');
  const episode = state.card.episodes[0] || null;

  offerChoices([
    { label: 'Подобрать по практике', onPick: () => { addMessage('user', 'Подобрать по практике'); offerPracticeLines6(episode, 0); } },
    { label: 'Написать тезис своими словами', onPick: () => { addMessage('user', 'Своими словами'); awaitText('Введите тезис защиты своими словами.', text => onThesis6(episode, text)); } }
  ], 'Как создать линию защиты?');
}

function offerPracticeLines6(episode, offset) {
  const page = PRACTICE_LINES.slice(offset, offset + PRACTICE_PAGE_SIZE);
  const hasMore = offset + PRACTICE_PAGE_SIZE < PRACTICE_LINES.length;

  offerChoices([
    ...page.map(p => ({
      label: p.title,
      sub: `${p.cases} дел в практике`,
      wide: true,
      onPick: () => {
        addMessage('user', p.title);
        createLine6(episode, p.title, null);
      }
    })),
    ...(hasMore ? [{ label: 'Показать еще', ghost: true, onPick: () => offerPracticeLines6(episode, offset + PRACTICE_PAGE_SIZE) }] : [])
  ], offset === 0 ? 'Линии защиты с наиболее объёмной практикой:' : null);
}

async function onThesis6(episode, thesis) {
  await think('Подбираю подходящие линии защиты', 1600);
  offerChoices([
    ...GUESSED_LINES.map(title => ({
      label: title,
      wide: true,
      onPick: () => {
        addMessage('user', title);
        createLine6(episode, title, thesis);
      }
    })),
    { label: 'Не устроил ни один из вариантов', ghost: true, onPick: () => { addMessage('user', 'Не устроил ни один из вариантов'); createLine6(episode, null, thesis); } }
  ], 'Похоже на одну из этих линий — выберите подходящую:');
}

/** 6.3 — куда добавить текст по созданной линии. */
async function createLine6(episode, title, thesis) {
  await think('Создаю линию защиты', 1500);

  const line = {
    id: `line-new-${state.card.lines.length + 1}`,
    episodeId: episode ? episode.id : null,
    title: title || 'Новая линия защиты (без названия)',
    thesis: thesis || 'Тезис сформирован автоматически по материалам практики.',
    generatedText: REGEN_FALLBACK_TEXT
  };
  state.card.lines.push(line);
  renderCaseCard(`.case-card__line[data-id="${line.id}"]`);

  const options = [];
  if (state.activeBlockId) {
    options.push({
      label: 'Добавить после активного блока',
      onPick: async () => {
        addMessage('user', 'Добавить после активного блока');
        await think('Генерирую текст по линии защиты', 1800);
        insertBlock(line.generatedText, { afterId: state.activeBlockId });
        state.boundLines.add(line.id);
        endScenario('Текст по линии добавлен после активного блока, просительная часть обновлена.');
      }
    });
  }
  options.push(
    {
      label: 'Добавить в конец документа',
      onPick: async () => {
        addMessage('user', 'Добавить в конец документа');
        await think('Генерирую текст по линии защиты', 1800);
        insertBlock(line.generatedText);
        state.boundLines.add(line.id);
        endScenario('Текст по линии добавлен в конец документа, просительная часть обновлена.');
      }
    },
    {
      label: 'Не добавлять',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Не добавлять');
        endScenario('Линия создана и сохранена в карточку дела. Текст в документ не добавлялся.');
      }
    }
  );

  offerChoices(options, 'Линия создана. Добавить текст по ней в документ?');
}

/* ================= Сценарий №15: проверка документа ================= */

function unboundLines() {
  return state.card.lines.filter(l => !state.boundLines.has(l.id));
}

function startCheckDoc() {
  startScenario('check-doc', 'Проверка документа');
  step15_1();
}

async function step15_1() {
  await think('Проверяю линии защиты, не добавленные в документ', 1300);
  const unbound = unboundLines();

  if (!unbound.length) {
    addMessage('assistant', state.card.lines.length
      ? 'Все линии защиты добавлены в документ.'
      : 'В карточке дела пока нет линий защиты.');
    return step15_rest();
  }

  offerChoices([
    {
      label: 'Добавить все линии',
      onPick: async () => {
        addMessage('user', 'Добавить все линии');
        await think('Генерирую текст документа по выбранным линиям защиты', 2200);
        unbound.forEach(line => {
          insertBlock(line.generatedText || REGEN_FALLBACK_TEXT);
          state.boundLines.add(line.id);
        });
        addMessage('assistant', `Текст по ${unbound.length} лини${unbound.length === 1 ? 'и' : 'ям'} добавлен в документ.`);
        step15_rest();
      }
    },
    {
      label: 'Пропустить',
      ghost: true,
      onPick: () => {
        addMessage('user', 'Пропустить');
        step15_rest();
      }
    }
  ], `Обнаружены линии защиты, не добавленные в текст документа: ${unbound.length}. Добавить?`);
}

/** Шаги 15.2–15.7 — последовательный чек-лист. */
async function step15_rest() {
  await think('Проверяю привязку блоков к линиям защиты', 1100);
  const warnBlocks = state.blocks.filter(b => b.status !== 'done').length;
  addMessage('assistant', warnBlocks
    ? `Есть блоки без привязанной линии защиты: ${warnBlocks} (отмечены «!»). Привязать линию можно командой «привяжи линию» по активному блоку.`
    : 'Все блоки привязаны к линиям защиты.');

  await think('Проверяю доказательства по линиям защиты', 1100);
  addMessage('assistant', state.card.evidence.length
    ? 'У всех линий защиты есть доказательства.'
    : 'В карточке дела нет доказательств — привязка доказательств к линиям будет доступна из меню ии-звёздочки.');

  await think('Проверяю просительную часть', 1100);
  addMessage('assistant', 'Просительная часть собрана и покрывает текущий состав блоков.');

  await think('Проверяю полноту документа', 1300);
  addMessage('assistant', 'Документ можно дополнить: указание на смягчающие обстоятельства (ст. 61 УК РФ) и ходатайство об исследовании видеозаписи в судебном заседании.');

  await think('Проверяю противоречия между блоками', 1300);
  endScenario('Противоречий между блоками не найдено. Проверка документа завершена.');
}

/* ================= Сценарий №17: генерация текста по линиям ================= */

function startGenByLines() {
  startScenario('gen-by-lines', 'Генерация текста по линиям защиты');
  runGenByLines();
}

async function runGenByLines() {
  const unbound = unboundLines();
  if (!unbound.length) {
    endScenario(state.card.lines.length
      ? 'Все линии защиты уже привязаны к блокам документа.'
      : 'В карточке дела нет линий защиты — создайте линию командой «создай линию».');
    return;
  }

  await think('Генерирую текст по непривязанным линиям защиты', 2200);
  unbound.forEach(line => {
    insertBlock(line.generatedText || REGEN_FALLBACK_TEXT);
    state.boundLines.add(line.id);
  });
  endScenario(`Текст по ${unbound.length} ранее непривязанн${unbound.length === 1 ? 'ой линии' : 'ым линиям'} защиты вставлен в конец документа. Просительная часть обновлена.`);
}

/* ================= Сценарий №14: справка ================= */

function startHelp() {
  const el = addMessage('assistant', HELP_TEXT);
  el.classList.add('msg--pre');
}

/* ================= Сценарий №3: разбор DOCX (по скрепке) ================= */

function onAttachClick() {
  if (state.busy) return;

  if (state.scenario) {
    askInterrupt('Разбор файла', () => runDocxScenario());
    return;
  }
  runDocxScenario();
}

async function runDocxScenario() {
  startScenario('docx', 'Разбор документа');
  addFileMessage(DOCX_FILE_NAME);

  await think('Проверяю, приговор ли это первой инстанции', 1500);
  addMessage('assistant', 'Это приговор первой инстанции — продолжаю разбор.');

  await think('Разбираю документ: доверитель, фабула, доказательства, стадии, участники, обстоятельства, линии защиты', 3000);

  state.card = clone(DOCX_PARSED_CARD);
  renderCaseCard();
  addMessage('assistant', 'Карточка дела обновлена по материалам приговора.');

  const c = state.card;
  addMessage('assistant',
    `Отчёт по разбору:\n` +
    `• Доверитель: ${c.client}\n` +
    `• Эпизодов фабулы: ${c.episodes.length}\n` +
    `• Линий защиты: ${c.lines.length}\n` +
    `• Доказательств: ${c.evidence.length}\n` +
    `• Обстоятельств: ${c.circumstances.length}`).classList.add('msg--pre');

  // 3.5 → сценарий 17
  state.scenario = null;
  startScenario('gen-by-lines', 'Генерация текста по линиям защиты');
  runGenByLines();
}

/* ================= Ввод ================= */

function sendPrompt() {
  if (state.busy) return;
  const text = promptEl.value.trim();
  if (!text) return;
  promptEl.value = '';
  autosize();
  addMessage('user', text);
  routeText(text);
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
sendBtn.addEventListener('click', sendPrompt);
attachBtn.addEventListener('click', onAttachClick);

/* ================= Шапка ================= */

$('#btn-download').addEventListener('click', () => window.print());
$('#btn-print').addEventListener('click', () => window.print());
$('#btn-logs').addEventListener('click', e => e.preventDefault());

/* ================= Старт ================= */

resetDemo(0);
