/**
 * Background Service Worker
 * Управляет связью между вкладками YouTube и Gemini, кэшированием результатов.
 */

// --- Константы ---
const CACHE_KEY = 'rskip_cache_v1';
const GEMINI_URL = 'https://gemini.google.com/app';

// В памяти будем держать ID текущего анализируемого видео, чтобы не спамить Gemini одинаковыми запросами.
let currentAnalyzingVideoId = null;

// Идентификатор вкладки Gemini, которую мы используем для анализа
let activeGeminiTabId = null;

// Подписчики: вкладки YouTube, которые ждут ответа по конкретному видео
// Формат: { "VIDEO_ID": [tabId1, tabId2] }
let videoWaiters = {};

// --- Базовые утилиты ---

/**
 * Получить кэш из chrome.storage.local
 */
async function getCache() {
    const data = await chrome.storage.local.get(CACHE_KEY);
    return data[CACHE_KEY] || {};
}

/**
 * Сохранить результаты в кэш
 * @param {string} videoId 
 * @param {Array} timings 
 */
async function saveToCache(videoId, timings) {
    const cache = await getCache();
    cache[videoId] = timings;
    await chrome.storage.local.set({ [CACHE_KEY]: cache });
    console.debug(`[RSKIP Background] Кэш сохранен для видео ${videoId}`);
}

/**
 * Найти уже открытую вкладку Gemini
 */
async function findGeminiTab() {
    const tabs = await chrome.tabs.query({ url: "*://gemini.google.com/app*" });
    if (tabs.length > 0) {
        return tabs[0];
    }
    return null;
}

/**
 * Открыть новую вкладку Gemini (неактивную в фоне)
 */
async function openGeminiTab() {
    const tab = await chrome.tabs.create({ url: GEMINI_URL, active: false });
    return tab;
}

let pendingVideoToAnalyze = null; // { videoId, videoUrl }

// --- Обработка сообщений ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 0. Скрипт Gemini прогрузился и готов
    if (message.action === 'gemini_ready') {
        const geminiTabId = sender.tab.id;
        console.debug(`[RSKIP Background] Gemini скрипт загрузился во вкладке ${geminiTabId}`);
        if (pendingVideoToAnalyze) {
            startAnalysisInGemini(geminiTabId, pendingVideoToAnalyze.videoId, pendingVideoToAnalyze.videoUrl);
            pendingVideoToAnalyze = null;
        }
        sendResponse({ status: 'ok' });
        return true;
    }

    // 1. YouTube запрашивает анализ видео
    if (message.action === 'analyze_video_request') {
        const videoId = message.videoId;
        const videoUrl = message.videoUrl;
        const senderTabId = sender.tab.id;

        console.debug(`[RSKIP Background] Получен запрос на анализ ${videoId}`);

        handleYouTubeRequest(videoId, videoUrl, senderTabId);

        // Возвращаем true, чтобы оставить канал открытым для асинхронного ответа (sendResponse)
        sendResponse({ status: 'processing' });
        return true;
    }

    // 2. Скрипт Gemini прислал результаты анализа
    if (message.action === 'gemini_analysis_result') {
        const videoId = message.videoId;
        const timings = message.timings;

        console.debug(`[RSKIP Background] Получен результат от Gemini для ${videoId}`, timings);
        handleGeminiResult(videoId, timings);

        sendResponse({ status: 'ok' });
        return true;
    }
});

// --- Внутренняя логика ---

async function handleYouTubeRequest(videoId, videoUrl, senderTabId) {
    try {
        // Проверяем локальный кэш
        const cache = await getCache();
        if (cache[videoId]) {
            console.debug(`[RSKIP Background] Видео ${videoId} найдено в кэше! Отправляем ответ Ютубу.`);
            sendResultToYouTube(senderTabId, videoId, cache[videoId]);
            return;
        }

        // Если уже анализируем это видео
        if (currentAnalyzingVideoId === videoId) {
            console.debug(`[RSKIP Background] Видео ${videoId} уже анализируется.. добавляем в очередь ожидания.`);
            if (!videoWaiters[videoId]) videoWaiters[videoId] = [];
            videoWaiters[videoId].push(senderTabId);
            return;
        }

        // Начинаем анализ
        currentAnalyzingVideoId = videoId;
        if (!videoWaiters[videoId]) videoWaiters[videoId] = [];
        videoWaiters[videoId].push(senderTabId);

        sendUpdateToYouTube(videoId, "⌛ Открываем чат Gemini...");

        // Ищем открытую вкладку Gemini
        let geminiTab = await findGeminiTab();
        if (!geminiTab) {
            console.debug(`[RSKIP Background] Вкладка Gemini не найдена. Создаю новую...`);
            pendingVideoToAnalyze = { videoId, videoUrl };
            await openGeminiTab();
            // Дальше ждем события 'gemini_ready'
            return;
        } else {
            // Вкладка уже существует, проверим отвечает ли она (скрипт заинжекчен)
            console.debug(`[RSKIP Background] Вкладка найдена. Проверяю готовность...`);
            try {
                const res = await chrome.tabs.sendMessage(geminiTab.id, { action: 'ping' });
                if (res && res.status === 'ok') {
                    startAnalysisInGemini(geminiTab.id, videoId, videoUrl);
                } else {
                    throw new Error("No response"); // Скрипт не ответил, перезагружаем
                }
            } catch (e) {
                console.debug(`[RSKIP Background] Gemini не отвечает, перезагружаю вкладку...`);
                pendingVideoToAnalyze = { videoId, videoUrl };
                await chrome.tabs.reload(geminiTab.id);
            }
        }

    } catch (error) {
        console.error(`[RSKIP Background] Ошибка при обработке запроса:`, error);
        sendUpdateToYouTube(videoId, "❌ Ошибка при старте анализа! Попробуйте позже.", true);
        currentAnalyzingVideoId = null; // Сброс состояния
    }
}

function startAnalysisInGemini(geminiTabId, videoId, videoUrl) {
    activeGeminiTabId = geminiTabId;
    console.debug(`[RSKIP Background] Отправляю задачу во вкладку Gemini (${activeGeminiTabId})...`);
    sendUpdateToYouTube(videoId, "🤖 ИИ щупает видео: ищем рекламу...");

    chrome.tabs.sendMessage(activeGeminiTabId, {
        action: 'start_gemini_analysis',
        videoId: videoId,
        videoUrl: videoUrl
    });
}

function sendUpdateToYouTube(videoId, text, isError = false) {
    const waitingTabs = videoWaiters[videoId] || [];
    for (const tabId of waitingTabs) {
        chrome.tabs.sendMessage(tabId, {
            action: 'rskip_status_update',
            text: text,
            isError: isError
        }).catch(e => { }); // Игнорим ошибки (если таба закрылась)
    }
}

async function handleGeminiResult(videoId, timings) {
    if (currentAnalyzingVideoId === videoId) {
        currentAnalyzingVideoId = null; // Освобождаем "рабочего"
    }

    // Сохраняем в кэш
    await saveToCache(videoId, timings);

    // Рассылаем всем ждущим вкладкам YouTube этот результат
    const waitingTabs = videoWaiters[videoId] || [];
    for (const tabId of waitingTabs) {
        sendResultToYouTube(tabId, videoId, timings);
    }

    // Очищаем очередь
    delete videoWaiters[videoId];
}

function sendResultToYouTube(tabId, videoId, timings) {
    console.debug(`[RSKIP Background] Пересылаю тайминги во вкладку = ${tabId}`);
    chrome.tabs.sendMessage(tabId, {
        action: 'rskip_timings_ready',
        videoId: videoId,
        timings: timings
    }).catch(err => {
        console.error(`[RSKIP Background] Вкладка ${tabId} больше недоступна (возможно закрыта).`);
    });
}

console.debug(`[RSKIP Background] Service Worker запущен.`);
