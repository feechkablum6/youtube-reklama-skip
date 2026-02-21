# Архитектура проекта

## Общая структура
Проект использует классическую архитектуру браузерного расширения Chrome (Manifest V3) **без сборщика бандлов (bundler)**. Чистый Vanilla JS для максимального быстродействия.

```text
/
├── manifest.json         # Входная точка расширения, разрешения
├── background/
│   └── background.js     # Service Worker. Управляет вкладками, кэшем и является шиной данных
├── content/
│   ├── youtube.js        # Скрипт-инжектор для YouTube. Управляет DOM плеера
│   └── gemini.js         # Скрипт-инжектор для Gemini. Имитирует пользователя и парсит ответы
├── popup/
│   ├── popup.html        # UI настроек расширения
│   ├── popup.css         # Стили с фокусом на современные эффекты (glassmorphism/blur)
│   └── popup.js          # Логика настроек и сохранения в chrome.storage
├── icons/                # Иконки расширения
└── README.md
```

## Ключевые технические решения

### Взаимодействие (Messaging)
1. `youtube.js` обнаруживает новое видео (`yt-navigate-finish` или MutationObserver) и посылает URL в `background.js` (через `chrome.runtime.sendMessage`).
2. `background.js` проверяет локальный кэш (`chrome.storage.local`).
3. Если кэша нет, `background.js` ищет открытую вкладку `gemini.google.com`. Если её нет — создает (возможно, неактивную для пользователя).
4. `background.js` отправляет приказ вкладке Gemini: `{action: 'analyze_video', url: '...'}`, который принимает `gemini.js`.
5. `gemini.js` взаимодействует с DOM страницы Gemini, отправляет Промпт в `textarea`, ждет ответа от ИИ (через MutationObserver за DOM-деревом ответов чата).
6. После получения JSON ответа (регулярным выражением из текста), `gemini.js` шлет ответ обратно в `background.js`.
7. `background.js` кэширует результат и пересылает его в `youtube.js`.
8. `youtube.js` маркирует таймлайн.

### Хранилище (Кэш)
- **Тип**: `chrome.storage.local`
- **Структура**:
  ```json
  {
      "cache_v1": {
          "VIDEO_ID_1": [
               { "type": "intro", "start": 0, "end": 15 },
               { "type": "sponsor", "start": 120, "end": 180 }
          ]
      }
  }
  ```
- **Лимиты**: `chrome.storage.local` позволяет хранить до 5 МБ данных (или безгранично с разрешением `unlimitedStorage`), чего хватит на десятки тысяч закэшированных видео.

### UI и стилизация (Popup)
- Vanilla CSS с использованием `--css-variables` для поддержки разных тем.
- Эффекты: Размытие фона (`backdrop-filter: blur`), плавные transition. 
- Дизайн: Premium Dark, современный минимализм.

## Зависимости
Сторонних NPM-пакетов или фреймворков нет. Модель поведения опирается исключительно на стандарты браузерного API (`chrome.*`).
