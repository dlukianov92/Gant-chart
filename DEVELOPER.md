# Правила разработки — «План работ» PWA

Документ фиксирует архитектуру и правила после Phase 0 (фундамент).  
Все дальнейшие изменения делаются **на основе этих правил**.

---

## 1. Цель продукта

Мобильный offline-first инструмент прораба:
- план работ (Gantt),
- готовность / бюджет / кэшфло,
- закупка материалов (корзина → заявки),
- несколько проектов.

Приоритет: **лёгкость на телефоне**, предсказуемые данные, безопасный рост справочников.

---

## 2. Слои (обязательное разделение ответственности)

| Слой | Что делает | Чего НЕ делает |
|------|------------|----------------|
| **core** | StorageAdapter, ключи, schema/migrate, id | DOM, расчёты бюджета |
| **domain** | bars, types, catalog, requests, budget/readiness/labor | `innerHTML`, sheet open/close |
| **ui** | screens, sheets, render Gantt, toast | прямая запись в localStorage в обход Adapter |

Сейчас код ещё в одном `index.html`, но **логические блоки уже размечены комментариями**.  
Новый код класть в соответствующий блок. Не смешивать domain-расчёты с DOM.

### Принцип
- UI вызывает domain/core.
- Domain не знает про кнопки и sheet.
- Storage только через `StorageAdapter`.

---

## 3. Ключи хранилища (контракт)

```text
gantt_projects                 // индекс проектов {v, projects[], cur}
gantt_board_{projectId}        // board: bars + types + elemRes + detail (пока вместе)
gantt_board_{id}__lastGood     // последний успешный snapshot board
gantt_catalog_{projectId}      // резерв Phase 1 (вынос catalog)
gantt_requests_{projectId}     // заявки на материалы
gantt_zoom / gantt_view / …    // UI prefs
```

**Правила**
- Любые данные проекта — с `projectId` в ключе или внутри записи.
- Не использовать глобальные ключи вроде `mat_requests` без projectId.
- Новые сущности → новый ключ + запись в этот документ.

---

## 4. Schema и миграции

- Актуальная версия board: **`SCHEMA_VERSION = 8`** (в `serialize`).
- Любое изменение формы JSON board:
  1. Поднять `SCHEMA_VERSION`.
  2. Добавить ветку в `migrateBoard(o)`.
  3. Описать миграцию здесь (дата + что изменилось).
- `hydrate` **всегда** вызывает `migrateBoard`.
- Импорт: `validateImportPayload` → migrate → hydrate → `saveImmediate`.

### История
| v | Изменение |
|---|-----------|
| 6 | Базовая сериализация types/elemRes/detail/bars |
| 7 | Явный migrate, индексы typesById, last-good, requests per project |
| 8 | Split catalog (elemRes+detail) → `gantt_catalog_{id}`; IndexedDB backend; board без тяжёлого catalog |

---

## 5. StorageAdapter (единственный путь к диску)

```text
StorageAdapter.getSync(k)
StorageAdapter.setSync(k, v)  → {ok, error?: 'quota'|'write'|'no_ls'}
StorageAdapter.removeSync(k)
StorageAdapter.getAsync(k, cb)
StorageAdapter.setAsync(k, v)
```

**Правила**
- Не вызывать `localStorage.*` напрямую в новом коде.
- При `error === 'quota'` — toast пользователю, не молчать.
- Перед опасной перезаписью (import/reset) — писать `__lastGood`.
- `save()` debounce ~180 ms; `saveImmediate()` — синхронно когда нужна гарантия.

---

## 6. State и индексы

```text
state = { bars, types, elemRes, detail }
typesById = {}      // Map-like object, rebuildTypeIndex()
stateRev            // счётчик ревизий после load/save
```

После любого изменения `state.types` → `rebuildTypeIndex()`.  
`typeById(id)` использует индекс; linear fallback только как страховка.

**Phase 1:** вынести `elemRes` + `detail` в `catalog:{projectId}` и грузить лениво.

---

## 7. Domain-расчёты (чистые функции)

Должны оставаться **без DOM**:
- `pkgResources`, `pkgCost`, `elemBudget`, `objBudget`
- `readiness`, `budgetData`
- `computeLabor`, `pkgDonePct`, …

UI только отображает результат.  
Новые формулы — сюда же, с тестом на serialize/hydrate round-trip по возможности.

---

## 8. UI-правила

- Экраны: `scrProjects`, `scrHome`, `scrGantt`.
- Модалки: bottom sheet + overlay; закрытие по grab-swipe / overlay / кнопке.
- Весь пользовательский текст в DOM — через `escapeHtml` или `textContent`.
- Не строить HTML из импорта без sanitize.
- Тяжёлые sheet (calc, kpi) — данные по открытию, не на каждый frame.

---

## 9. Заявки и корзина

- Корзина `calcCart` — только сессия UI (не persist).
- Заявки: `loadRequests()` / `saveRequests()` → ключ `gantt_requests_{projectId}`.
- Запись заявки содержит `projectId`, `num`, `items[]`, `total`, `status`.
- Смена проекта → другой ключ requests (изоляция).

---

## 10. Производительность

| Правило | Деталь |
|---------|--------|
| Не полный `render()` без нужды | drag end — точечный update, если возможно |
| Debounce save | уже в `save()` |
| Индексы | `typesById` после hydrate |
| Лимиты импорта | bars ≤ 5000, types ≤ 2000, file ≤ 8 МБ |
| Будущее | IDB для catalog; виртуализация Gantt при >300 bars |

Ориентир: открытие проекта и скролл Gantt плавные на среднем Android 2019+.

---

## 11. Безопасность

- XSS: только `escapeHtml` / textContent для user strings.
- Import: validate + size limit + last-good.
- CSP meta уже задан (Open-Meteo в connect-src).
- SW: только same-origin assets; внешние API мимо кэша.
- При деплое **всегда** поднимать `CACHE` в `sw.js` (v22, v23, …).

---

## 12. Как фиксировать изменения

1. Коротко описать в commit / changelog: *что / зачем / schema?*
2. Если менялся JSON board → migrate + строка в §4.
3. Если новый storage key → строка в §3.
4. Если новая сущность domain → не писать в localStorage в обход Adapter.
5. После релиза SW: `plan-rabot-vN` → `vN+1`.
6. Регресс-чек:
   - открытие 2 проектов,
   - save/load board,
   - import валидного JSON,
   - калькулятор → заявка → список заявок,
   - offline после первого визита.

---

## 13. Roadmap слоёв (не ломать Phase 0)

**Phase 1 — сделано (v23)**
- IndexedDB backend в Adapter (primary для крупных значений)
- Split `gantt_catalog_{projectId}` (elemRes + detail) от board
- Board serialize: types + bars only
- `ensureCatalogLoaded` / lazy load для калькулятора и справочника
- Автомиграция: старый blob → catalog key + slim board

**Phase 2 — сделано (v24)**
- `app.css` — стили отдельно
- `js/domain-calc.js` — чистые domain-расчёты (тестируемые)
- `js/app.js` — UI + storage + Gantt
- `tests/domain-tests.html` — автопроверки migrate/budget/done%/labor
- Виртуализация Gantt: offscreen bars не создаются в DOM; re-render по scroll debounce
- SW кэширует css/js модули (`plan-rabot-v24`)

**Phase 3**
- Опциональный sync-backend на том же domain API

---

## 14. Запрещено

- Глобальные данные проекта без `projectId`
- `localStorage.setItem` в feature-коде
- `innerHTML` с сырыми именами/note из импорта
- Менять shape board без migrate
- Класть секреты/токены в LS
- Полный re-render на каждый input поля

---

## 15. Быстрый чеклист PR

- [ ] Только StorageAdapter для персиста  
- [ ] Ключи с projectId где нужно  
- [ ] Schema/migrate если менялся JSON  
- [ ] escapeHtml на user text  
- [ ] SW version bump при релизе  
- [ ] Ручной smoke: 2 проекта, import, заявка  

---

*Файл обновлять при каждом изменении контракта данных или слоёв.*
'''
print("DEVELOPER.md written", len(open('/home/workdir/artifacts/DEVELOPER.md').read()))


## 16. Структура файлов (v24)

```text
index.html              # разметка + подключение css/js
app.css                 # стили
js/domain-calc.js       # domain (pure) — PlanDomain.*
js/app.js               # core storage + UI
tests/domain-tests.html # открыть в браузере для проверки domain
sw.js
manifest.webmanifest
icons…
DEVELOPER.md
```

Новые domain-формулы сначала добавлять в `js/domain-calc.js` + тест, затем подключать в UI.
