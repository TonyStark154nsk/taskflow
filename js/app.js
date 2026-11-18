(() => {
  'use strict';

  const STORAGE_KEY = 'taskflow.tasks.v1';
  const BACKUP_KEY = 'taskflow.tasks.recovery';
  const MAX_LENGTH = 300;
  const state = { tasks: [], filter: 'all', query: '', editingId: null, undo: null };
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    form: $('#add-form'), input: $('#task-input'), error: $('#input-error'),
    list: $('#task-list'), template: $('#task-template'), empty: $('#empty-state'),
    search: $('#search-input'), searchBox: $('#search-box'), searchToggle: $('#search-toggle'),
    clear: $('#clear-completed'), warning: $('#storage-warning'), saveStatus: $('#save-status'),
    toast: $('#toast'), toastMessage: $('#toast-message'), undo: $('#undo-button'),
    help: $('#help-dialog'),
  };
  let toastTimer;
  let writesBlocked = false;
  let renderedIds = new Set();
  const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

  function showStorageWarning(message) {
    elements.warning.textContent = message;
    elements.warning.hidden = false;
    elements.saveStatus.textContent = 'Есть проблема с сохранением — смотрите предупреждение выше';
  }

  // Validate every record: LocalStorage is external, potentially damaged input.
  function decodeTasks(raw) {
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || !Array.isArray(data.tasks)) {
      throw new Error('Неподдерживаемый формат данных');
    }
    const ids = new Set();
    const tasks = data.tasks.filter((task) => {
      const valid = task && typeof task.id === 'string' && task.id.length > 0 && task.id.length <= 100
        && !ids.has(task.id) && typeof task.text === 'string' && task.text.trim().length > 0
        && task.text.trim().length <= MAX_LENGTH && typeof task.completed === 'boolean'
        && typeof task.createdAt === 'number' && Number.isFinite(task.createdAt)
        && task.createdAt > 0 && task.createdAt <= 8640000000000000;
      if (valid) ids.add(task.id);
      return valid;
    }).map(({ id, text, completed, createdAt }) => ({ id, text: text.trim(), completed, createdAt }));
    return { tasks, damaged: tasks.length !== data.tasks.length };
  }

  function preserveRecovery(raw) {
    try {
      localStorage.setItem(BACKUP_KEY, raw);
      return true;
    } catch {
      writesBlocked = true;
      return false;
    }
  }

  function loadTasks() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      showStorageWarning('Браузер запретил доступ к хранилищу. Задачи работают в этой вкладке, но после её закрытия могут потеряться. Разрешите сохранение данных сайта.');
      return [];
    }
    if (raw === null) return [];
    try {
      const decoded = decodeTasks(raw);
      if (decoded.damaged) {
        const backedUp = preserveRecovery(raw);
        showStorageWarning(backedUp
          ? 'Часть сохранённых записей повреждена. Корректные задачи восстановлены; исходные данные оставлены в резервной копии браузера.'
          : 'Часть записей повреждена. Корректные задачи восстановлены, но сохранение отключено, чтобы не затереть исходные данные.');
      }
      return decoded.tasks;
    } catch {
      // Never silently overwrite an unknown schema (possibly a newer app version).
      let unknownVersion = false;
      try { unknownVersion = JSON.parse(raw)?.version !== 1; } catch { /* Invalid JSON is recoverable via backup. */ }
      if (unknownVersion) {
        writesBlocked = true;
        showStorageWarning('Сохранённые данные имеют неизвестный формат. Они не изменены. Новые задачи доступны только в этой вкладке — сохранение отключено для защиты исходных данных.');
      } else {
        const backedUp = preserveRecovery(raw);
        showStorageWarning(backedUp
          ? 'Не удалось прочитать сохранённые задачи. Открыт пустой список; исходные данные сохранены в резервную копию браузера. Новые задачи будут сохраняться как обычно.'
          : 'Сохранённые данные повреждены. Список работает в памяти; сохранение отключено, чтобы не затереть исходные данные.');
      }
      return [];
    }
  }

  function saveTasks() {
    if (writesBlocked) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, tasks: state.tasks }));
      elements.saveStatus.textContent = 'Все изменения сохранены в этом браузере';
      // A recovery warning stays visible, even after a successful new save.
      if (!elements.warning.textContent.includes('поврежден') && !elements.warning.textContent.includes('повреждён')
          && !elements.warning.textContent.includes('резервн')) elements.warning.hidden = true;
      return true;
    } catch {
      showStorageWarning('Не удалось сохранить изменения: хранилище заполнено или недоступно. Задачи остаются в этой вкладке. Не закрывайте её, пока не освободите место или не разрешите хранение данных.');
      return false;
    }
  }

  function createTask(text, completed = false) {
    const id = globalThis.crypto?.randomUUID?.()
      ?? `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return { id, text, completed, createdAt: Date.now() };
  }

  function getVisibleTasks() {
    const query = state.query.toLocaleLowerCase('ru-RU');
    return state.tasks.filter((task) => (
      (state.filter === 'all' || (state.filter === 'completed' ? task.completed : !task.completed))
      && task.text.toLocaleLowerCase('ru-RU').includes(query)
    ));
  }

  function updateStats() {
    const total = state.tasks.length;
    const completed = state.tasks.filter((task) => task.completed).length;
    const counts = { all: total, active: total - completed, completed };
    for (const [key, value] of Object.entries(counts)) {
      document.querySelectorAll(`[data-count="${key}"], [data-stat="${key}"]`).forEach((node) => { node.textContent = value; });
    }
    const percent = total ? Math.round(completed / total * 100) : 0;
    $('#progress-percent').firstChild.textContent = percent;
    $('#progress-fill').style.transform = `scaleX(${percent / 100})`;
    $('#progress-bar').setAttribute('aria-valuenow', percent);
    $('#progress-bar').setAttribute('aria-valuetext', `${completed} из ${total} задач выполнено`);
    $('#remaining-label').textContent = total
      ? counts.active ? `Осталось выполнить: ${counts.active}` : 'Всё выполнено. Отличная работа!'
      : 'Новый день — новые возможности';
    elements.clear.disabled = completed === 0;
  }

  function renderEmpty(isEmpty) {
    elements.empty.hidden = !isEmpty;
    elements.list.hidden = isEmpty;
    $('.empty-label').textContent = state.query ? 'Результаты поиска'
      : state.filter === 'completed' ? 'Сделанное'
        : state.tasks.length ? 'Можно выдохнуть' : 'С чистого листа';
    let title, description, action;
    if (state.query) {
      title = 'Ничего не нашлось';
      description = 'Попробуйте другое слово\nили сбросьте поиск и фильтры.';
      action = 'Сбросить поиск и фильтры';
    } else if (state.filter === 'completed') {
      title = 'Победы ещё впереди';
      description = 'Отметьте первую выполненную задачу —\nона появится здесь.';
      action = 'Перейти к активным';
    } else if (state.filter === 'active' && state.tasks.length) {
      title = 'Всё важное уже сделано';
      description = 'Ни одной активной задачи.\nМожно выдохнуть или придумать новый план.';
      action = 'Добавить новую задачу';
    } else {
      title = 'Всё начинается с одной задачи';
      description = 'Запишите то, что важно сейчас.\nПервый шаг — уже движение вперёд.';
      action = 'Добавить первую задачу';
    }
    $('#empty-title').textContent = title;
    $('#empty-description').textContent = description;
    $('#empty-description').style.whiteSpace = 'pre-line';
    $('#empty-action').firstChild.textContent = `${action} `;
    $('#demo-button').hidden = state.tasks.length > 0 || state.filter !== 'all' || Boolean(state.query);
  }

  function render() {
    const tasks = getVisibleTasks();
    const fragment = document.createDocumentFragment();
    tasks.forEach((task) => {
      const row = elements.template.content.firstElementChild.cloneNode(true);
      row.dataset.id = task.id;
      row.classList.toggle('is-completed', task.completed);
      if (renderedIds.has(task.id)) row.style.animation = 'none';
      const checkbox = row.querySelector('input');
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', `${task.completed ? 'Вернуть в активные' : 'Выполнить'}: ${task.text}`);
      row.querySelector('.task-text').textContent = task.text;
      row.querySelector('.task-meta').textContent = task.completed ? 'Выполнено' : dateFormatter.format(task.createdAt);
      row.querySelector('[data-action="edit"]').setAttribute('aria-label', `Редактировать: ${task.text}`);
      row.querySelector('[data-action="delete"]').setAttribute('aria-label', `Удалить: ${task.text}`);
      fragment.append(row);
    });
    elements.list.replaceChildren(fragment);
    renderedIds = new Set(tasks.map((task) => task.id));
    state.editingId = null;
    $('#visible-count').textContent = tasks.length;
    document.querySelectorAll('[data-filter]').forEach((button) => {
      const active = button.dataset.filter === state.filter;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active);
    });
    renderEmpty(tasks.length === 0);
    updateStats();
  }

  function commit() {
    // Persistence is synchronous and never depends on a finishing animation.
    saveTasks();
    render();
  }

  function notify(message, undo = null) {
    clearTimeout(toastTimer);
    state.undo = undo;
    elements.toastMessage.textContent = message;
    elements.undo.hidden = !undo;
    elements.toast.hidden = false;
    toastTimer = setTimeout(hideToast, undo ? 10000 : 4500);
  }

  function hideToast() {
    // Do not hide a keyboard-focused notification until focus leaves it.
    if (elements.toast.contains(document.activeElement)) {
      toastTimer = setTimeout(hideToast, 2000);
      return;
    }
    clearTimeout(toastTimer);
    elements.toast.hidden = true;
    state.undo = null;
  }

  function animateRemoval(row) {
    if (!row || matchMedia('(prefers-reduced-motion: reduce)').matches || !row.animate) return;
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    Object.assign(ghost.style, {
      position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`,
      height: `${rect.height}px`, pointerEvents: 'none', zIndex: '20', background: getComputedStyle(document.body).backgroundColor,
      margin: '0', listStyle: 'none', animation: 'none',
    });
    document.body.append(ghost);
    ghost.animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(22px) scale(.98)' }],
      { duration: 220, easing: 'ease-out' }).finished.catch(() => {}).finally(() => ghost.remove());
  }

  function addTask(event) {
    event.preventDefault();
    const text = elements.input.value.trim();
    if (!text || text.length > MAX_LENGTH) {
      elements.error.textContent = !text ? 'Сначала напишите задачу' : `Максимум ${MAX_LENGTH} символов`;
      elements.input.setAttribute('aria-invalid', 'true');
      elements.input.focus();
      return;
    }
    state.tasks.unshift(createTask(text));
    // Make the new task visible even if the user was viewing completed/search results.
    if (state.filter === 'completed') state.filter = 'all';
    resetSearch();
    elements.input.value = '';
    elements.error.textContent = '';
    elements.input.removeAttribute('aria-invalid');
    commit();
    elements.input.focus();
    notify('Задача добавлена. Первый шаг сделан.');
  }

  function deleteTasks(ids) {
    const removed = state.tasks.map((task, index) => ({ task, index })).filter(({ task }) => ids.includes(task.id));
    if (!removed.length) return;
    const focusIndex = [...elements.list.children].findIndex((row) => ids.includes(row.dataset.id));
    [...elements.list.children].filter((row) => ids.includes(row.dataset.id)).forEach(animateRemoval);
    state.tasks = state.tasks.filter((task) => !ids.includes(task.id));
    commit();
    const target = elements.list.children[Math.min(Math.max(focusIndex, 0), elements.list.children.length - 1)];
    (target?.querySelector('[data-action="delete"]') ?? elements.input).focus();
    notify(removed.length === 1 ? 'Задача удалена' : `Удалено выполненных задач: ${removed.length}`, () => {
      removed.forEach(({ task, index }) => {
        if (!state.tasks.some((item) => item.id === task.id)) state.tasks.splice(Math.min(index, state.tasks.length), 0, task);
      });
      commit();
      elements.input.focus();
      notify('Задачи восстановлены');
    });
  }

  function startEditing(row) {
    if (state.editingId) render();
    row = [...elements.list.children].find((item) => item.dataset.id === row.dataset.id);
    if (!row) return;
    const task = state.tasks.find((item) => item.id === row.dataset.id);
    state.editingId = task.id;
    const form = document.createElement('form');
    form.className = 'task-edit-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.maxLength = MAX_LENGTH;
    input.value = task.text;
    input.setAttribute('aria-label', 'Новый текст задачи');
    const hint = document.createElement('span');
    hint.className = 'edit-hint';
    hint.textContent = 'Enter — сохранить · Esc — отменить';
    hint.setAttribute('role', 'status');
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'edit-button';
    save.textContent = 'Сохранить';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'edit-button cancel';
    cancel.textContent = 'Отмена';
    form.append(input, save, cancel, hint);
    row.querySelector('.task-content').replaceChildren(form);
    row.querySelector('.task-actions').hidden = true;
    row.querySelector('input[type="checkbox"]').disabled = true;
    const finish = () => {
      render();
      [...elements.list.children].find((item) => item.dataset.id === task.id)?.querySelector('[data-action="edit"]').focus();
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text || text.length > MAX_LENGTH) {
        hint.textContent = 'Введите от 1 до 300 символов. Пустую задачу сохранить нельзя.';
        input.setAttribute('aria-invalid', 'true');
        input.focus();
        return;
      }
      task.text = text;
      saveTasks();
      finish();
      notify('Изменения применены');
    });
    cancel.addEventListener('click', finish);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(); }
      if (event.key === 'Enter' && event.isComposing) event.preventDefault();
    });
    input.focus();
    input.select();
  }

  function resetSearch() {
    state.query = '';
    elements.search.value = '';
  }

  function toggleSearch(force) {
    const open = force ?? elements.searchBox.hidden;
    elements.searchBox.hidden = !open;
    elements.searchToggle.setAttribute('aria-expanded', String(open));
    if (open) elements.search.focus();
    else { resetSearch(); render(); elements.searchToggle.focus(); }
  }

  function bindEvents() {
    elements.form.addEventListener('submit', addTask);
    elements.input.addEventListener('input', () => {
      elements.error.textContent = '';
      elements.input.removeAttribute('aria-invalid');
    });
    elements.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.isComposing) event.preventDefault();
    });
    document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      render();
    }));
    elements.list.addEventListener('change', (event) => {
      if (!event.target.matches('input[type="checkbox"]')) return;
      const row = event.target.closest('.task-row');
      const task = state.tasks.find((item) => item.id === row.dataset.id);
      task.completed = event.target.checked;
      const index = [...elements.list.children].indexOf(row);
      const id = task.id;
      commit();
      const sameRow = [...elements.list.children].find((item) => item.dataset.id === id);
      const nextRow = elements.list.children[Math.min(index, elements.list.children.length - 1)];
      (sameRow?.querySelector('input') ?? nextRow?.querySelector('input') ?? elements.input).focus();
      if (sameRow?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const highlight = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
        sameRow.animate([{ background: highlight }, { background: 'transparent' }], { duration: 500 });
      }
      notify(task.completed ? 'Ещё одна маленькая победа. Так держать!' : 'Задача снова в активных');
    });
    elements.list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const row = button.closest('.task-row');
      if (button.dataset.action === 'delete') deleteTasks([row.dataset.id]);
      if (button.dataset.action === 'edit') startEditing(row);
    });
    elements.clear.addEventListener('click', () => deleteTasks(state.tasks.filter((task) => task.completed).map((task) => task.id)));
    elements.undo.addEventListener('click', () => {
      const undo = state.undo;
      state.undo = null;
      if (undo) undo();
    });
    $('#toast-close').addEventListener('click', () => {
      elements.input.focus();
      hideToast();
    });
    elements.toast.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    elements.toast.addEventListener('mouseleave', () => { toastTimer = setTimeout(hideToast, 4500); });
    elements.searchToggle.addEventListener('click', () => toggleSearch());
    elements.search.addEventListener('input', () => { state.query = elements.search.value.trim(); render(); });
    elements.search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); toggleSearch(false); }
    });
    $('#empty-action').addEventListener('click', () => {
      if (state.query) { resetSearch(); state.filter = 'all'; }
      else if (state.filter === 'completed') state.filter = 'active';
      render();
      elements.input.focus();
    });
    $('#demo-button').addEventListener('click', () => {
      if (state.tasks.length) return;
      state.tasks = [createTask('Выбрать главное на сегодня'), createTask('Разбить большую цель на маленькие шаги'), createTask('Оставить время для себя'), createTask('Познакомиться с TaskFlow', true)];
      commit();
      notify('Добавлены примеры. Их можно изменить или удалить.');
    });
    document.querySelectorAll('[data-help]').forEach((button) => button.addEventListener('click', () => elements.help.showModal()));
    $('#close-help').addEventListener('click', () => elements.help.close());
    elements.help.addEventListener('click', (event) => {
      const rect = elements.help.getBoundingClientRect();
      if (event.target === elements.help && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) elements.help.close();
    });
    document.addEventListener('keydown', (event) => {
      if (elements.help.open) return;
      const typing = event.target.matches('input, textarea, [contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); toggleSearch(true); }
      if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key.toLowerCase() === 'n' || event.key.toLowerCase() === 'т') { event.preventDefault(); elements.input.focus(); }
        if (event.key === '?') elements.help.showModal();
      }
    });
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      writesBlocked = false;
      state.tasks = loadTasks();
      state.undo = null;
      render();
      notify('Список обновлён из другой вкладки');
    });
  }

  const now = new Date();
  $('#current-date').dateTime = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  $('#current-date').textContent = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' }).format(now);
  state.tasks = loadTasks();
  bindEvents();
  render();
})();
