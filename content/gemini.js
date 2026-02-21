/**
 * Content Script для gemini.google.com
 * Имитирует действия пользователя: ввод промпта и отправка, чтение ответа.
 */

// Переопределяем Visibility API, чтобы Gemini думал, что вкладка активна (даже если она в фоне)
const injectCode = `
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
    Object.defineProperty(document, 'hidden', { value: false, writable: false });
    window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
`;
const script = document.createElement('script');
script.textContent = injectCode;
(document.head || document.documentElement).appendChild(script);
script.remove();

console.log("[RSKIP Gemini] Скрипт-инжектор инициализирован.");

// Сообщаем Background'у, что скрипт загружен и готов принимать команды
chrome.runtime.sendMessage({ action: 'gemini_ready' });

// --- Селекторы (Вынесены для удобства обновления, если Google поменяет дизайн) ---
const SEL = {
    // Ввод
    promptInput: 'div[aria-label="Enter a prompt for Gemini"].ql-editor',
    promptInputAlt1: 'rich-textarea div[contenteditable="true"]',
    promptInputAlt2: 'div[role="textbox"][contenteditable="true"]',
    promptInputAlt3: 'textarea[aria-label="Enter a prompt here"]',
    sendBtn: 'button[aria-label="Send message"]',
    sendBtnAlt: 'button.send-button',

    // Модель
    modelPickerBtn: 'button[aria-label="Open mode picker"]',
    modelMenuItem: 'button[role="menuitemradio"]', // Нужно будет искать по тексту

    // Вывод
    messageContainer: 'message-content', // Это кастомный тег
};

// Храним ссылку на видео, которую анализируем сейчас
let currentVideoId = null;
let currentVideoUrl = null;

// Обработчик сообщений от Background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
        sendResponse({ status: 'ok' });
        return true;
    }

    if (message.action === 'start_gemini_analysis') {
        currentVideoId = message.videoId;
        currentVideoUrl = message.videoUrl;

        console.log(`[RSKIP Gemini] Получена задача на анализ: ${currentVideoUrl}`);

        // Запускаем процесс
        startAnalysisFlow();

        sendResponse({ status: "processing" });
        return true;
    }
});

/**
 * Основной поток (Workflow) взаимодействия с ИИ
 */
async function startAnalysisFlow() {
    try {
        await waitForGeminiLoad();
        await ensureProModelSelected();
        await insertPromptAndSend();
        await waitForResponseAndExtract();
    } catch (error) {
        console.error("[RSKIP Gemini] Ошибка в потоке анализа:", error);
        reportErrorToBackground(error.message || String(error));
    }
}

function reportErrorToBackground(msg) {
    chrome.runtime.sendMessage({
        action: 'gemini_analysis_error',
        videoId: currentVideoId,
        error: msg
    });
}

/**
 * Ждет, пока React-приложение Gemini отрендерит DOM-дерево
 */
async function waitForGeminiLoad() {
    console.log("[RSKIP Gemini] Ожидаю загрузки интерфейса...");
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 40; // 20 секунд (по 500мс)

        const interval = setInterval(() => {
            attempts++;
            const input = document.querySelector(`${SEL.promptInput}, ${SEL.promptInputAlt1}, ${SEL.promptInputAlt2}, ${SEL.promptInputAlt3}`);
            
            if (input) {
                clearInterval(interval);
                console.log("[RSKIP Gemini] Интерфейс загружен.");
                resolve();
            } else if (attempts > maxAttempts) {
                clearInterval(interval);
                reject(new Error("Таймаут ожидания интерфейса Gemini (возможно долго грузится страница)."));
            }
        }, 500);
    });
}

/**
 * Пытается найти меню моделей и выбрать Pro
 */
async function ensureProModelSelected() {
    console.log("[RSKIP Gemini] Проверяю выбранную модель...");
    const pickerBtn = document.querySelector(SEL.modelPickerBtn);
    if (!pickerBtn) {
        console.log("[RSKIP Gemini] Селектор моделей не найден, возможно он скрыт. Продолжаю.");
        return;
    }

    // Проверим, не Pro ли уже выбран (по тексту кнопки)
    if (pickerBtn.textContent.toLowerCase().includes('pro') || pickerBtn.textContent.toLowerCase().includes('advanced')) {
        console.log("[RSKIP Gemini] Модель Pro уже активна.");
        return;
    }

    console.log("[RSKIP Gemini] Открываю меню моделей...");
    pickerBtn.click();

    // Ждем анимацию открытия меню
    await new Promise(r => setTimeout(r, 800));

    const menuItems = document.querySelectorAll(SEL.modelMenuItem);
    let proItem = Array.from(menuItems).find(item => item.textContent.toLowerCase().includes('pro') || item.textContent.toLowerCase().includes('advanced'));

    if (proItem) {
        console.log("[RSKIP Gemini] Переключаю на модель Pro...");
        proItem.click();
        await new Promise(r => setTimeout(r, 1500)); // Ждем применения
    } else {
        console.log("[RSKIP Gemini] Модель Pro не найдена в списке. Используем текущую.");
        // Закрываем меню (клик куда-нибудь)
        document.body.click();
    }
}

/**
 * Формирует строгий промпт, вставляет в редактор и отправляет
 */
async function insertPromptAndSend() {
    // Пробуем несколько возможных селекторов для поля
    const possibleInputs = [
        SEL.promptInput,
        SEL.promptInputAlt1,
        SEL.promptInputAlt2,
        SEL.promptInputAlt3
    ];
    
    let inputArea = null;
    for (const s of possibleInputs) {
        inputArea = document.querySelector(s);
        if (inputArea) {
            console.log(`[RSKIP Gemini] Поле ввода найдено по селектору: ${s}`);
            break;
        }
    }
    
    if (!inputArea) {
        throw new Error("Не найдено поле ввода промпта. Google изменил интерфейс.");
    }

    const promptText = `Проанализируй видео по ссылке: ${currentVideoUrl}
Найди точные тайминги (в секундах) для следующих категорий (если они есть):

Сегменты (имеют начало и конец):
1. sponsor: Платная реклама, реферальные ссылки, прямая реклама (не любимые проекты креатора).
2. selfpromo: Неоплачиваемая или самореклама (мерч, донаты, с кем сотрудничали).
3. interaction: Напоминания поставить лайк, подписаться, поделиться (даже короткие).
4. outro: Титры или финальные заставки (без сюжетной/обучающей инфы).
5. preview: Подборка фрагментов того, что будет дальше в видео, краткий обзор.
6. greeting: Трейлеры, озвученные приветствия и прощания, пустая болтовня в начале без информации.

Точки (имеют только точное время начала):
7. chapter: Названия основных глав/разметок видео.
8. highlight: Самая важная часть видео, ответ на кликбейт ("Видео начинается здесь").

Выведи СТРОГО валидный JSON-массив и больше ни единого слова (без markdown).
Пример:
[
  {"type": "sponsor", "start": 15, "end": 45},
  {"type": "highlight", "start": 120}
]`;

    // Фокусируемся (может игнорироваться в фоне)
    inputArea.focus();

    // 1. Пытаемся симулировать Paste (самый надежный способ для React)
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', promptText);
    const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
    });
    inputArea.dispatchEvent(pasteEvent);

    // 2. Фолбэк на execCommand (если в фокусе)
    document.execCommand('insertText', false, promptText);
    
    // 3. Фолбэк на прямое изменение
    if (inputArea.tagName && inputArea.tagName.toLowerCase() === 'textarea') {
        inputArea.value = promptText;
    } else {
        if (!inputArea.textContent.includes("Проанализируй")) {
            inputArea.textContent = promptText;
        }
    }

    // Выстреливаем события Input для React
    inputArea.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true }));
    inputArea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true }));

    // Ждем чтобы React обработал изменение состояния и активировал кнопку отправки
    await new Promise(r => setTimeout(r, 1000));

    // Ищем кнопку отправки
    const possibleButtons = [
        SEL.sendBtn,
        SEL.sendBtnAlt
    ];
    let sendBtn = null;
    for (const s of possibleButtons) {
        sendBtn = document.querySelector(s);
        if (sendBtn && !sendBtn.disabled) break;
    }

    if (!sendBtn) {
        throw new Error("Кнопка отправки не найдена или заблокирована стейтом.");
    }

    // Отправляем
    sendBtn.click();
    console.log("[RSKIP Gemini] Промпт отправлен через клик.");
}

/**
 * Ждет ответа (появления нового message-content) и извлекает JSON
 */
async function waitForResponseAndExtract() {
    console.log("[RSKIP Gemini] Ожидаю ответа от ИИ...");

    // Запоминаем текущее количество сообщений
    const initialMessageCount = document.querySelectorAll(SEL.messageContainer).length;

    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 120; // 60 секунд (по 500мс)

        const checkInterval = setInterval(() => {
            attempts++;
            const messages = document.querySelectorAll(SEL.messageContainer);

            // Если появилось новое сообщение
            if (messages.length > initialMessageCount) {
                const latestMessageContainer = messages[messages.length - 1];
                const rawText = latestMessageContainer.textContent;

                // Проверяем, закончил ли ИИ печатать
                const jsonMatch = extractJsonFromString(rawText);

                if (jsonMatch) {
                    clearInterval(checkInterval);
                    console.log("[RSKIP Gemini] Успешно получен JSON-ответ:", jsonMatch);

                    // Отправляем данные в background
                    sendResultsToBackground(currentVideoId, jsonMatch);
                    resolve();
                } else if (attempts > maxAttempts) {
                    clearInterval(checkInterval);
                    console.warn("[RSKIP Gemini] Таймаут ожидания ответа. Текст, который удалось получить:", rawText);
                    reject(new Error("Таймаут ожидания. Слишком долгая генерация либо ИИ ответил не в JSON."));
                }
            } else if (attempts > maxAttempts) {
                clearInterval(checkInterval);
                console.warn("[RSKIP Gemini] Сообщение от ИИ так и не появилось.");
                reject(new Error("Сообщение от ИИ так и не появилось."));
            }
        }, 500);
    });
}

/**
 * Ищет начало [ и конец ] массива и парсит
 */
function extractJsonFromString(str) {
    try {
        const startIdx = str.indexOf('[');
        const endIdx = str.lastIndexOf(']');

        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
            const jsonStr = str.substring(startIdx, endIdx + 1);
            const parsed = JSON.parse(jsonStr);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        // Parse error (not fully generated yet)
    }
    return null;
}

/**
 * Финальная отправка в Background
 */
function sendResultsToBackground(videoId, timingsArray) {
    chrome.runtime.sendMessage({
        action: 'gemini_analysis_result',
        videoId: videoId,
        timings: timingsArray // Ожидается формат [{type, start, (end)}]
    });
}
