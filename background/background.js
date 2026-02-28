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
const ANALYSIS_PROMPT_TEMPLATE = (videoUrl) => `Ты — точный видеоаналитик. Посмотри видео по ссылке и найди тайминги.
Ссылка: ${videoUrl}

═══ СЕГМЕНТЫ (имеют start и end в секундах) ═══

1. sponsor — Платная интеграция/реклама.
   Что искать: ютубер прерывает основной контент и начинает рассказывать про продукт, сервис или приложение спонсора. Часто начинается фразами: "а сейчас расскажу про спонсора", "спонсор этого видео", "это видео при поддержке", "переходите по ссылке в описании".
   Включает: рекламные вставки (VPN, игры, приложения, курсы), показ промокодов, демонстрацию спонсорского продукта, чтение рекламного скрипта.
   НЕ включает: упоминание собственных товаров автора (это selfpromo), просьбы подписаться (это interaction).
   description: напиши конкретно ЧТО рекламируется — "Реклама NordVPN", "Интеграция Skillbox", "Промокод на игру Raid".

2. selfpromo — Самореклама автора канала.
   Что искать: автор продвигает свои собственные продукты, каналы, соцсети, мерч, курсы, стримы, Telegram, Discord. Не оплачено третьей стороной.
   Включает: "подписывайтесь на мой телеграм", "купить мой мерч", "ссылка на мой второй канал", "приходите на мой стрим", реклама собственных курсов, приглашение в Discord-сервер автора.
   description: конкретно что продвигает — "Приглашение в Telegram-канал", "Реклама мерча", "Анонс стрима".

3. interaction — Просьбы о взаимодействии.
   Что искать: автор просит зрителя совершить действие на YouTube.
   Включает: "ставьте лайк", "подписывайтесь на канал", "нажмите колокольчик", "пишите в комментариях", "голосуйте в опросе", "поделитесь видео". Обычно это 5–20 секунд.
   НЕ включает: призывы перейти в соцсети автора (это selfpromo).
   description: что именно просит — "Просьба поставить лайк и подписаться", "Призыв написать комментарий".

4. outro — Финальная заставка, титры.
   Что искать: карточки с рекомендациями других видео в конце, музыкальная заставка без содержания, экран с надписью "спасибо за просмотр", анимация канала на фоне. Основной контент уже закончился.
   НЕ включает: подведение итогов видео (если автор ещё говорит по теме — это не outro).
   description: что происходит — "Финальная заставка с карточками", "Титры", "Музыкальный аутро".

5. preview — Превью/тизер будущего контента.
   Что искать: нарезка моментов из текущего видео в начале ("что вас ждёт сегодня"), или тизер будущего видео в конце. Быстрая смена кадров, драматичная музыка, вырванные из контекста цитаты.
   description: что показывают — "Нарезка ярких моментов видео", "Тизер следующего выпуска".

6. greeting — Вступление, болтовня до основной темы.
   Что искать: приветствие ("привет всем", "здарова"), представление канала, анимированное интро канала, болтовня не по теме перед основным контентом, затянувшееся вступление.
   НЕ включает: если сразу после приветствия автор переходит к теме — не помечай.
   description: что происходит — "Приветствие и анимированное интро", "Болтовня перед началом темы".

═══ ТОЧКИ (имеют только start в секундах) ═══

7. chapter — Смысловые разделы видео.
   ПРАВИЛА:
   • Каждый chapter — это новый смысловой блок, когда автор переходит к другой теме, этапу, вопросу или действию.
   • НЕ пиши "Глава 1", "Раздел 2", "Начало видео" — это бессмысленно.
   • description ОБЯЗАТЕЛЬНО содержит конкретную тему этого раздела.
   Примеры хороших description: "Выбор ингредиентов для борща", "Тест камеры при ночной съёмке", "Сравнение RTX 4090 vs 4080", "Ответы на вопросы подписчиков", "Распаковка посылки из Китая", "Поездка на заброшенный завод".
   Примеры ПЛОХИХ description (НЕ ПИШИ ТАК): "Глава 1", "Начало", "Первый раздел", "Основная часть", "Продолжение".
   • Не дублируй chapter если это место уже помечено как greeting, sponsor или другой сегмент.
   • Обычно в видео 3-8 глав. Не ставь chapter на каждую минуту — только на реальную смену темы.

8. highlight — Ключевой момент / кульминация видео.
   Что искать (в порядке приоритета):
   a) "Видео начинается тут" — момент, о котором зрители пишут в комментариях. Если есть длинное вступление, greeting, preview — highlight ставится туда, где реально начинается основной контент.
   b) Кульминация / развязка — если в видео есть нарастающее напряжение, highlight = момент развязки. Примеры: объявление победителя розыгрыша, финальный результат эксперимента, ответ на главный вопрос видео, момент победы/поражения, раскрытие сюрприза.
   c) Самый яркий момент — если нет явной кульминации, ищи момент с максимальной эмоциональной реакцией автора или самый зрелищный кадр.
   ПРАВИЛА:
   • Ставь 1-2 highlight на видео, не больше.
   • Не ставь highlight на места которые уже помечены как chapter, если нет веской причины.
   • Если не можешь уверенно определить highlight — не ставь его вообще. Лучше 0 чем неточный.
   description: конкретно что происходит — "Объявление победителя розыгрыша iPhone", "Момент взрыва эксперимента", "Начало основного контента после 3 минут вступления", "Финальный результат теста скорости".

═══ ФОРМАТ ОТВЕТА ═══

Выведи СТРОГО валидный JSON-массив. Никакого текста вокруг, никакого markdown.
Поле "description" ОБЯЗАТЕЛЬНО для каждого элемента — без него ответ бесполезен.
Тайминги start и end — в секундах (целые числа).
Если категория отсутствует в видео — просто не включай её.

Пример:
[
  {"type": "greeting", "start": 0, "end": 12, "description": "Приветствие и заставка канала"},
  {"type": "sponsor", "start": 65, "end": 120, "description": "Реклама VPN-сервиса Surfshark"},
  {"type": "chapter", "start": 12, "description": "Распаковка новой видеокарты"},
  {"type": "chapter", "start": 130, "description": "Тестирование в Cyberpunk 2077"},
  {"type": "chapter", "start": 280, "description": "Сравнение с предыдущей моделью"},
  {"type": "highlight", "start": 350, "description": "Итоговые результаты бенчмарков"},
  {"type": "interaction", "start": 400, "end": 415, "description": "Просьба поставить лайк и подписаться"},
  {"type": "outro", "start": 420, "end": 440, "description": "Финальная заставка с карточками"}
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
