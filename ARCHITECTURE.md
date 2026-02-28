# Архитектура проекта

## Общая структура
Проект использует классическую архитектуру браузерного расширения Chrome (Manifest V3) **без сборщика бандлов (bundler)**. Чистый Vanilla JS для максимального быстродействия. Интеграция с Gemini AI через **Native Messaging** (Python native host, вызывающий gemini-cli).

```text
/
├── manifest.json         # Входная точка расширения, разрешения
├── background/
│   └── background.js     # Service Worker. Управляет Native Messaging, кэшем и является шиной данных
├── content/
│   └── youtube.js        # Скрипт-инжектор для YouTube. Управляет DOM плеера
├── native_host/
│   ├── gemini_host.py    # Python Native Messaging host — вызывает gemini-cli
│   ├── com.rskip.gemini.json  # Шаблон манифеста Native Messaging
│   └── install.sh        # Скрипт установки native host для Chrome/Chromium
├── popup/
│   ├── popup.html        # UI настроек расширения
│   ├── popup.css         # Стили с фокусом на современные эффекты (glassmorphism/blur)
│   └── popup.js          # Логика настроек и сохранения в chrome.storage
├── icons/                # Иконки расширения
└── README.md
```

## Ключевые технические решения

### Взаимодействие (Messaging)
1. `youtube.js` обнаруживает новое видео (`yt-navigate-finish` или поллинг URL) и посылает URL в `background.js` (через `chrome.runtime.sendMessage`).
2. `background.js` проверяет локальный кэш (`chrome.storage.local`).
3. Если кэша нет, `background.js` вызывает Python native host через `chrome.runtime.sendNativeMessage()` с промптом для анализа видео.
4. Native host (`gemini_host.py`) получает запрос по протоколу Chrome Native Messaging (4 байта длины + JSON), вызывает `gemini_cli.client.ask()`, извлекает JSON-массив из ответа и возвращает результат.
5. `background.js` кэширует результат и пересылает его в `youtube.js`.
6. `youtube.js` маркирует таймлайн.

### Native Messaging
- **Протокол**: Chrome Native Messaging — stdin/stdout, 4 байта длины (little-endian) + JSON payload.
- **Host**: `native_host/gemini_host.py` — Python-скрипт, импортирует `gemini_cli.client.ask()` для общения с Gemini API.
- **Манифест**: `com.rskip.gemini` — регистрируется в `~/.config/google-chrome/NativeMessagingHosts/`.
- **Установка**: `native_host/install.sh <extension-id>` — подставляет пути и ID расширения в манифест, копирует в нужные директории.

### Хранилище (Кэш)
- **Тип**: `chrome.storage.local`
- **Структура** (новый формат — один ключ на видео):
  ```json
  {
      "rskip_cache_v1_VIDEO_ID_1": [
           { "type": "sponsor", "start": 120, "end": 180, "description": "Реклама VPN" }
      ]
  }
  ```
- Поддержка миграции со старого вложенного формата `cache_v1`.
- **Лимиты**: `chrome.storage.local` позволяет хранить до 5 МБ данных (или безгранично с разрешением `unlimitedStorage`), чего хватит на десятки тысяч закэшированных видео.

### UI и стилизация (Popup)
- Vanilla CSS с использованием `--css-variables` для поддержки разных тем.
- Эффекты: Размытие фона (`backdrop-filter: blur`), плавные transition.
- Дизайн: Premium Dark, современный минимализм.

## Зависимости
- **Браузерные**: стандарты Chrome Extension API (`chrome.*`), без NPM-пакетов или фреймворков.
- **Native host**: Python 3, `gemini-cli` (устанавливается через `pip install -e`), `gemini-webapi`.
