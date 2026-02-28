# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Обзор

Chrome-расширение (Manifest V3), которое автоматически пропускает спонсорские вставки, интро, саморекламу и другие нежелательные сегменты в видео на YouTube. Использует Google Gemini AI через Native Messaging (Python native host + gemini-cli). Чистый Vanilla JS/CSS, без бандлеров и npm-зависимостей.

## Разработка

Сборки нет. Загружается как распакованное расширение:
1. `chrome://extensions/` → Режим разработчика → Загрузить распакованное → выбрать эту папку
2. После изменений перезагрузить расширение (или использовать `extension-reloader` из родительского монорепо)

Дополнительно нужно установить Native Messaging host:
```bash
cd native_host && ./install.sh <extension-id>
```

Тестов, линтера и CI нет. Проверка только вручную в браузере.

## Ключевые файлы

| Файл | Назначение |
|------|------------|
| `manifest.json` | Точка входа расширения, разрешения и content scripts |
| `background/background.js` | Service Worker — шина данных между YouTube и gemini-cli, кэширование |
| `native_host/gemini_host.py` | Python Native Messaging host — вызывает gemini-cli для анализа видео |
| `native_host/install.sh` | Скрипт установки native host для Chrome/Chromium |
| `native_host/com.rskip.gemini.json` | Шаблон манифеста Native Messaging |
| `content/youtube.js` | Инжектируется на YouTube — отрисовка маркеров, автопропуск, UI тосты |
| `popup/popup.js` | Логика настроек (глобальный переключатель, категории, очистка кэша) |
| `popup/popup.html/css` | UI попапа — Premium Dark, glassmorphism |

## Архитектура

### Поток сообщений

```
YouTube (youtube.js)
    → sendMessage('analyze_video_request')
    → Background (background.js)
        → проверяет кэш chrome.storage.local
        → если промах: chrome.runtime.sendNativeMessage('com.rskip.gemini', ...)
        → Native Host (gemini_host.py)
            → получает промпт через stdin (Native Messaging протокол)
            → открывает chat_session() через gemini-cli
            → очищает ответ от markdown-обёрток (```json ... ```)
            → извлекает JSON-массив из ответа ИИ
            → при пустом/невалидном ответе — ретрай в том же чате (до 2 раз)
            → возвращает результат через stdout
        → Background кэширует и рассылает всем YouTube-вкладкам
    → YouTube получает тайминги
        → рисует цветные маркеры на прогресс-баре
        → автоматически перематывает по настройкам
```

### Стратегия Native Messaging

Background вызывает `chrome.runtime.sendNativeMessage()` с промптом. Chrome запускает Python-процесс `gemini_host.py`, который общается через stdin/stdout по протоколу Native Messaging (4 байта длины little-endian + JSON). Host использует `gemini_cli.client.chat_session()` для создания чат-сессии с Gemini — это позволяет отправлять follow-up сообщения в том же контексте при невалидном ответе. Ответ очищается от markdown-обёрток (`strip_markdown_codeblock`), затем из него извлекается JSON-массив (`extract_json_array`). При пустом или невалидном ответе выполняется до 2 ретраев в том же чате. Результат (JSON-массив таймингов) возвращается в callback `sendNativeMessage`.

### Хранилище

- **Кэш**: ключи `rskip_cache_v1_{VIDEO_ID}` (есть миграция со старого вложенного формата `cache_v1`)
- **Настройки**: ключ `rskip_settings` — `globalAutoSkip` (bool) + `categories` (объект с переключателями по типам)
- Изменения настроек распространяются в реальном времени через `chrome.storage.onChanged`

## Соглашения

- Логирование с префиксом `[RSKIP Background]`, `[RSKIP YouTube]`, `[RSKIP Host]`
- Стили маркеров в `MARKER_STYLES` вверху `youtube.js`
- `camelCase` для переменных/функций, `kebab-case` для CSS-классов/ID
- Константы и селекторы — всегда в начале файла
- Бандлеры (Webpack/Vite/Rollup) запрещены
- XSS-защита: `escapeHTML()` для описаний от ИИ перед вставкой в innerHTML

## Хрупкие места и действия при поломке

### Native host не отвечает
1. Проверить, что `gemini_host.py` исполняемый: `chmod +x native_host/gemini_host.py`
2. Проверить, что манифест установлен: `ls ~/.config/google-chrome/NativeMessagingHosts/com.rskip.gemini.json`
3. Проверить, что `gemini-cli` доступен: `python3 -c "from gemini_cli.client import ask; print('OK')"`
4. Проверить stderr native host: запустить вручную и посмотреть вывод ошибок
5. Переустановить: `cd native_host && ./install.sh <extension-id>`

### YouTube не реагирует на новое видео
- YouTube — SPA. Навигация ловится через `yt-navigate-finish` + `yt-page-data-updated` + поллинг URL раз в секунду
- `handleVideoChange()` дедуплицирует по `videoId` — если видео не меняется, повторного запроса не будет
- Проверить в DevTools консоли: `[RSKIP YouTube] Скрипт-инжектор инициализирован.`

### Service Worker потерял состояние
- Chrome может убить SW в любой момент, теряя `videoWaiters` и `currentAnalyzingVideoId`
- Митигация: `handleGeminiResult()` и `sendUpdateToYouTube()` рассылают результаты **всем** открытым YouTube-вкладкам, а не только ожидающим

## Дебаг

- **Background**: `chrome://extensions/` → «Просмотреть Service Worker» → DevTools консоль, фильтр `[RSKIP Background]`
- **YouTube**: DevTools на вкладке YouTube, фильтр `[RSKIP YouTube]`
- **Native Host**: stderr (ошибки пишутся в stderr процесса, видны при ручном запуске `gemini_host.py`)
- **Кэш**: `chrome.storage.local.get(null, console.log)` в консоли Background SW
- **Настройки**: `chrome.storage.local.get('rskip_settings', console.log)`

## Типы сегментов

| Тип | Визуал | Автоскип по умолчанию |
|-----|--------|-----------------------|
| `sponsor` | Фуксия полоса (fuchsia-500) | ВКЛ |
| `selfpromo` | Оранжевая полоса | ВКЛ |
| `interaction` | Жёлтая полоса | ВКЛ |
| `outro` | Серая полоса | ВКЛ |
| `preview` | Голубая полоса | ВЫКЛ |
| `greeting` | Фиолетовая полоса | ВЫКЛ |
| `chapter` | Зелёная вертикальная линия + иконка-маркер | — (точка) |
| `highlight` | Золотая вертикальная линия + звезда | — (точка) |

### Тултипы таймлайна

Маркеры на прогресс-баре не используют CSS `:hover` (YouTube перехватывает все mouse-события overlay-элементами). Вместо этого единый плавающий тултип (`#rskip-floating-tooltip`) позиционируется программно через `mousemove` на `.ytp-progress-bar-container`. Позиция зажимается (clamp) по краям viewport, стрелка тултипа смещается через CSS-переменную `--arrow-offset`. При наведении на маркер скрывается нативное превью YouTube (`ytp-tooltip`, `ytp-preview`).
