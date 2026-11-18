// Run only in a dedicated QA origin: this suite changes its task data.
(async () => {
  const results = [];
  const $ = (selector) => document.querySelector(selector);
  const rows = () => [...document.querySelectorAll('#task-list .task-row')];
  const saved = () => JSON.parse(localStorage.getItem('taskflow.tasks.v1')).tasks;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const test = (name, fn) => {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };
  const add = (text) => {
    $('#task-input').value = text;
    $('#add-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  };
  const filter = (name) => $(`.filter-tabs [data-filter="${name}"]`).click();

  test('Первый запуск без сохранённых данных', () => {
    assert(rows().length === 0 && !$('#empty-state').hidden, 'Нет пустого состояния');
    assert($('#progress-bar').getAttribute('aria-valuenow') === '0', 'Неверный прогресс');
  });
  test('Пустая задача и пробелы запрещены', () => {
    add(''); add('   ');
    assert(rows().length === 0 && $('#input-error').textContent, 'Добавлена пустая задача');
  });
  test('Добавление и обрезка пробелов', () => {
    add('  Первая задача  ');
    assert(rows().length === 1 && saved()[0].text === 'Первая задача', 'Не обрезаны пробелы');
  });
  test('Пользовательский текст вставляется безопасно', () => {
    add('<img src=x onerror="window.__injected=true">');
    assert(!$('#task-list img') && !window.__injected, 'HTML интерпретирован');
    assert(rows()[0].querySelector('.task-text').textContent.startsWith('<img'), 'Текст повреждён');
  });
  test('Выполнение задачи и статистика', () => {
    rows()[0].querySelector('input').click();
    assert(saved()[0].completed && rows()[0].classList.contains('is-completed'), 'Не выполнена');
    assert($('[data-stat="completed"]').textContent === '1', 'Неверная статистика');
    assert($('#progress-bar').getAttribute('aria-valuenow') === '50', 'Неверный прогресс');
  });
  test('Возврат выполненной задачи в активные', () => {
    rows()[0].querySelector('input').click();
    assert(!saved()[0].completed && !rows()[0].classList.contains('is-completed'), 'Не возвращена');
  });
  test('Редактирование: сохранение с обрезкой пробелов', () => {
    rows()[0].querySelector('[data-action="edit"]').click();
    $('.task-edit-input').value = '  Изменённая задача  ';
    $('.task-edit-form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    assert(saved()[0].text === 'Изменённая задача', 'Не сохранено');
  });
  test('Редактирование: запрет пустого текста и отмена Escape', () => {
    rows()[0].querySelector('[data-action="edit"]').click();
    $('.task-edit-input').value = '   ';
    $('.task-edit-form').dispatchEvent(new Event('submit', { cancelable: true }));
    assert($('.task-edit-input').getAttribute('aria-invalid') === 'true', 'Пустое принято');
    $('.task-edit-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(!$('.task-edit-input') && saved()[0].text === 'Изменённая задача', 'Отмена не сработала');
  });
  test('Фильтры: все / активные / выполненные', () => {
    rows()[0].querySelector('input').click();
    filter('active'); assert(rows().length === 1 && !rows()[0].querySelector('input').checked, 'Активные');
    filter('completed'); assert(rows().length === 1 && rows()[0].querySelector('input').checked, 'Выполненные');
    filter('all'); assert(rows().length === 2, 'Все');
  });
  test('Поиск и пустое состояние поиска', () => {
    $('#search-toggle').click();
    $('#search-input').value = 'ИЗМЕНЁННАЯ';
    $('#search-input').dispatchEvent(new Event('input'));
    assert(rows().length === 1, 'Регистронезависимый поиск');
    $('#search-input').value = 'нет-совпадений';
    $('#search-input').dispatchEvent(new Event('input'));
    assert(rows().length === 0 && $('#empty-title').textContent === 'Ничего не нашлось', 'Пустой поиск');
    $('#search-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert(rows().length === 2 && $('#search-box').hidden, 'Поиск не сброшен');
  });
  test('Очистка удаляет только выполненные', () => {
    $('#clear-completed').click();
    assert(saved().length === 1 && !saved()[0].completed, 'Удалены активные или остались выполненные');
    assert(rows().length === 1, 'Список не обновлён');
  });
  test('Отмена удаления восстанавливает статус и порядок', () => {
    $('#undo-button').click();
    assert(saved().length === 2 && saved()[0].completed && saved()[0].text === 'Изменённая задача', 'Восстановление неверно');
  });
  test('Быстрое последовательное удаление', () => {
    rows()[0].querySelector('[data-action="delete"]').click();
    rows()[0].querySelector('[data-action="delete"]').click();
    assert(saved().length === 0 && rows().length === 0, 'Удалённые остались');
  });
  test('У каждого фильтра корректное пустое состояние', () => {
    filter('completed'); assert($('#empty-title').textContent === 'Победы ещё впереди', 'Пустые выполненные');
    filter('active'); assert(!$('#empty-state').hidden, 'Пустые активные');
    filter('all'); assert($('#empty-title').textContent === 'Всё начинается с одной задачи', 'Пустые все');
  });
  test('Добавление в фильтре выполненных показывает новую задачу', () => {
    filter('completed'); add('Подготовка к перезагрузке');
    assert(rows().length === 1 && $('.filter-tabs [data-filter="all"]').getAttribute('aria-pressed') === 'true', 'Новая скрыта');
  });
  test('Ошибка записи LocalStorage не ломает приложение', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    try {
      add('Задача при переполнении');
      assert(rows().length === 2 && !$('#storage-warning').hidden, 'Ошибка не обработана');
    } finally { Storage.prototype.setItem = original; }
    add('Задача после восстановления');
    assert(saved().length === 3, 'Повторное сохранение не работает');
  });
  test('Справка открывается и закрывается', () => {
    document.querySelector('[data-help]').click(); assert($('#help-dialog').open, 'Не открылась');
    $('#close-help').click(); assert(!$('#help-dialog').open, 'Не закрылась');
  });
  test('Данные для проверки перезагрузки записаны', () => {
    rows()[0].querySelector('input').click();
    assert(saved().length === 3 && saved()[0].completed, 'Исходные данные неверны');
  });
  window.__qaResults = results;
  return results;
})();
