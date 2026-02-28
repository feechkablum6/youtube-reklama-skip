/**
 * Background Service Worker
 * Управляет связью между вкладками YouTube и gemini-cli через Native Messaging, кэшированием результатов.
 */

// --- Константы ---
const CACHE_KEY = 'rskip_cache_v1';
const NATIVE_HOST_NAME = 'com.rskip.gemini';

// В памяти: ID текущего анализируемого видео, чтобы не спамить одинаковыми запросами.
let currentAnalyzingVideoId = null;

// Подписчики: вкладки YouTube, которые ждут ответа по конкретному видео
// Формат: { "VIDEO_ID": [tabId1, tabId2] }
let videoWaiters = {};

// --- Промпт для Gemini ---
const ANALYSIS_PROMPT_TEMPLATE = (videoUrl) => `Проанализируй видео по ссылке: ${videoUrl}
Найди точные тайминги (в секундах) для следующих категорий (если они есть):

Сегменты (имеют начало и конец):
1. sponsor: Платная реклама, реферальные ссылки, прямая реклама.
2. selfpromo: Неоплачиваемая или самореклама.
3. interaction: Напоминания поставить лайк, подписаться.
4. outro: Титры или финальные заставки.
5. preview: Подборка фрагментов того, что будет дальше.
6. greeting: Трейлеры, приветствия, болтовня в начале.

Точки (имеют только время начала):
7. chapter: Названия основных глав.
8. highlight: Самая важная часть видео.

Выведи СТРОГО валидный JSON-массив и больше ни единого слова (без markdown). Для каждого найденного элемента ОБЯЗАТЕЛЬНО добавь поле "description" с кратким (1 короткое предложение) описанием того, что происходит в этом моменте или сегменте (например: "Реклама Raid Shadow Legends" или "Напоминает о подписке на канал").
Пример:
[
  {"type": "sponsor", "start": 15, "end": 45, "description": "Прямая реклама VPN"},
  {"type": "highlight", "start": 120, "description": "Начало сборки ПК"}
]`;

// --- Базовые утилиты ---

/**
 * Получить кэш из chrome.storage.local по ID видео
 */
async function getCache(videoId) {
    const key = `${CACHE_KEY}_${videoId}`;
    const data = await chrome.storage.local.get(key);
    if (data[key]) {
        return data[key];
    }

    // Fallback: кэш старого формата (миграция на лету)
    const oldData = await chrome.storage.local.get(CACHE_KEY);
    if (oldData[CACHE_KEY] && oldData[CACHE_KEY][videoId]) {
        const timings = oldData[CACHE_KEY][videoId];
        await chrome.storage.local.set({ [key]: timings });
        return timings;
    }

    return undefined;
}

/**
 * Сохранить результаты в кэш
 */
async function saveToCache(videoId, timings) {
    const key = `${CACHE_KEY}_${videoId}`;
    await chrome.storage.local.set({ [key]: timings });
    console.debug(`[RSKIP Background] Кэш сохранен для видео ${videoId}`);
}

// --- Обработка сообщений ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'analyze_video_request') {
        const videoId = message.videoId;
        const videoUrl = message.videoUrl;
        const senderTabId = sender.tab.id;

        console.debug(`[RSKIP Background] Получен запрос на анализ ${videoId}`);
        handleYouTubeRequest(videoId, videoUrl, senderTabId);

        sendResponse({ status: 'processing' });
        return true;
    }
});

// --- Внутренняя логика ---

async function handleYouTubeRequest(videoId, videoUrl, senderTabId) {
    try {
        // Проверяем локальный кэш
        const cachedTimings = await getCache(videoId);
        if (cachedTimings) {
            console.debug(`[RSKIP Background] Видео ${videoId} найдено в кэше!`);
            sendResultToYouTube(senderTabId, videoId, cachedTimings);
            return;
        }

        // Если уже анализируем это видео
        if (currentAnalyzingVideoId === videoId) {
            console.debug(`[RSKIP Background] Видео ${videoId} уже анализируется, добавляем в очередь.`);
            if (!videoWaiters[videoId]) videoWaiters[videoId] = [];
            videoWaiters[videoId].push(senderTabId);
            return;
        }

        // Начинаем анализ
        currentAnalyzingVideoId = videoId;
        if (!videoWaiters[videoId]) videoWaiters[videoId] = [];
        videoWaiters[videoId].push(senderTabId);

        sendUpdateToYouTube(videoId, "ИИ анализирует видео...");

        // Вызываем gemini-cli через Native Messaging
        const prompt = ANALYSIS_PROMPT_TEMPLATE(videoUrl);

        chrome.runtime.sendNativeMessage(
            NATIVE_HOST_NAME,
            { action: 'analyze', prompt: prompt, model: 'pro' },
            (response) => {
                if (chrome.runtime.lastError) {
                    const errorMsg = chrome.runtime.lastError.message;
                    console.error(`[RSKIP Background] Native host ошибка: ${errorMsg}`);
                    sendUpdateToYouTube(videoId, `Ошибка native host: ${errorMsg}`, true);
                    currentAnalyzingVideoId = null;
                    delete videoWaiters[videoId];
                    return;
                }

                if (response && response.success) {
                    console.debug(`[RSKIP Background] Получен результат от gemini-cli для ${videoId}`);
                    handleGeminiResult(videoId, response.data);
                } else {
                    const error = response ? response.error : 'Пустой ответ от native host';
                    console.error(`[RSKIP Background] Ошибка анализа: ${error}`);
                    sendUpdateToYouTube(videoId, `Ошибка ИИ: ${error}`, true);
                    currentAnalyzingVideoId = null;
                    delete videoWaiters[videoId];
                }
            }
        );

    } catch (error) {
        console.error(`[RSKIP Background] Ошибка при обработке запроса:`, error);
        sendUpdateToYouTube(videoId, `Ошибка: ${error.message || 'Неизвестная ошибка'}`, true);
        currentAnalyzingVideoId = null;
    }
}

function sendUpdateToYouTube(videoId, text, isError = false) {
    const waitingTabs = videoWaiters[videoId] || [];

    for (const tabId of waitingTabs) {
        chrome.tabs.sendMessage(tabId, {
            action: 'rskip_status_update',
            text: text,
            isError: isError
        }).catch(() => {});
    }

    // Широковещательная рассылка (на случай если SW скинул память)
    chrome.tabs.query({ url: "*://*.youtube.com/watch*" }, (tabs) => {
        for (const tab of tabs) {
            if (!waitingTabs.includes(tab.id)) {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'rskip_status_update',
                    text: text,
                    isError: isError
                }).catch(() => {});
            }
        }
    });
}

async function handleGeminiResult(videoId, timings) {
    if (currentAnalyzingVideoId === videoId) {
        currentAnalyzingVideoId = null;
    }

    await saveToCache(videoId, timings);

    // Рассылаем всем ждущим вкладкам YouTube
    const waitingTabs = videoWaiters[videoId] || [];
    for (const tabId of waitingTabs) {
        sendResultToYouTube(tabId, videoId, timings);
    }

    // Широковещательная рассылка
    chrome.tabs.query({ url: "*://*.youtube.com/watch*" }, (tabs) => {
        for (const tab of tabs) {
            if (!waitingTabs.includes(tab.id)) {
                sendResultToYouTube(tab.id, videoId, timings);
            }
        }
    });

    delete videoWaiters[videoId];
}

function sendResultToYouTube(tabId, videoId, timings) {
    console.debug(`[RSKIP Background] Пересылаю тайминги во вкладку = ${tabId}`);
    chrome.tabs.sendMessage(tabId, {
        action: 'rskip_timings_ready',
        videoId: videoId,
        timings: timings
    }).catch(err => {
        console.error(`[RSKIP Background] Вкладка ${tabId} больше недоступна.`);
    });
}

console.debug(`[RSKIP Background] Service Worker запущен.`);
