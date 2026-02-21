/**
 * Content Script для youtube.com
 * Идентифицирует видео, управляет UI таймлайна, осуществляет перемотку.
 */

console.log("[RSKIP YouTube] Скрипт-инжектор инициализирован.");

// --- Состояние ---
let currentVideoId = null;
let currentTimings = [];
let isVideoParsed = false;
let userSettings = {
    globalAutoSkip: true,
    categories: { sponsor: true, selfpromo: true, interaction: true, outro: true, preview: false, greeting: false }
};

// Настройки цветных меток (Полосы и Точки)
const MARKER_STYLES = {
    // Сегменты (Полосы)
    sponsor: { color: 'rgba(255, 0, 0, 0.7)', height: '100%', type: 'segment' }, // Красный
    selfpromo: { color: 'rgba(255, 165, 0, 0.7)', height: '100%', type: 'segment' }, // Оранжевый
    interaction: { color: 'rgba(255, 255, 0, 0.7)', height: '100%', type: 'segment' }, // Желтый
    outro: { color: 'rgba(128, 128, 128, 0.7)', height: '100%', type: 'segment' }, // Серый
    preview: { color: 'rgba(0, 191, 255, 0.7)', height: '100%', type: 'segment' }, // Светло-синий
    greeting: { color: 'rgba(169, 169, 169, 0.7)', height: '100%', type: 'segment' }, // Темно-серый

    // Точки
    chapter: { color: '#00FF00', size: '14px', type: 'point', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#00FF00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>' }, // Зеленая точка-маркер
    highlight: { color: '#FFD700', size: '14px', type: 'point', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="#FFD700" stroke="#FFD700" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' } // Золотая звезда
};

// Конфигурация того, что мы скипаем автоматически
const AUTO_SKIP_TYPES = ['sponsor', 'selfpromo', 'interaction', 'outro', 'preview', 'greeting'];

// --- Точка входа ---

// YouTube - это SPA (Single Page Application). Следим за навигацией (событие от YouTube)
document.addEventListener('yt-navigate-finish', handleVideoChange);

// Для подстраховки (первичная загрузка)
if (window.location.href.includes('/watch')) {
    handleVideoChange();
}

function handleVideoChange() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (!videoId) return;

    if (currentVideoId !== videoId) {
        currentVideoId = videoId;
        currentTimings = [];
        isVideoParsed = false;

        clearMarkers();
        requestAnalysis(videoId, window.location.href);
    }
}

// --- Коммуникация с Background ---

function requestAnalysis(videoId, videoUrl) {
    console.debug(`[RSKIP YouTube] Запрос анализа для ${videoId}`);
    chrome.runtime.sendMessage({
        action: 'analyze_video_request',
        videoId: videoId,
        videoUrl: videoUrl
    });
}

// Слушаем ответы от Background
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'rskip_timings_ready' && message.videoId === currentVideoId) {
        console.log(`[RSKIP YouTube] Получены тайминги:`, message.timings);
        currentTimings = message.timings;
        drawMarkers();
    }
});

// --- Взаимодействие с плеером ---

// Следим за временем, чтобы делать скип
const videoPoller = setInterval(() => {
    const videoElement = document.querySelector('video');
    if (videoElement && currentTimings.length > 0 && userSettings.globalAutoSkip) {
        checkAutoSkip(videoElement);
    }
}, 500); // Проверяем 2 раза в секунду

// Слушаем изменения настроек из Popup в реальном времени
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.rskip_settings) {
        userSettings = changes.rskip_settings.newValue;
        console.log("[RSKIP YouTube] Настройки обновлены:", userSettings);
    }
});

// Загружаем настройки при старте (если они есть)
chrome.storage.local.get('rskip_settings', (data) => {
    if (data.rskip_settings) {
        userSettings = data.rskip_settings;
    }
});

function checkAutoSkip(videoElement) {
    const currentTime = videoElement.currentTime;

    // Ищем сегмент для скипа (из тех, что относятся к сегментам, а не к точкам)
    for (const t of currentTimings) {
        const styleDef = MARKER_STYLES[t.type];

        // Скипаем только 'segment', и только если этот тип разрешен к скипу юзером
        if (styleDef && styleDef.type === 'segment' && userSettings.categories[t.type] === true) {
            // Если мы находимся внутри этого отвратительного сегмента
            // Учитываем небольшой запас (+1 сек к старту), чтобы не застрять в бесконечном цикле, если юзер кликнул ровно на начало
            if (currentTime >= t.start && currentTime < t.end - 1) {
                console.log(`[RSKIP YouTube] AUTO SKIP: [${t.type}] с ${currentTime} на ${t.end}`);
                videoElement.currentTime = t.end;

                // Показываем UI тост юзеру (опционально, реализуем позже)
                showSkipToast(t.type);
                return; // Перемотали, выходим из цикла
            }
        }
    }
}

function showSkipToast(type) {
    // Временный минималистичный тост-уведомление поверх плеера
    let toast = document.getElementById('rskip-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'rskip-toast';
        toast.style.cssText = `
            position: absolute; top: 10%; right: 5%;
            background: rgba(0,0,0,0.8); color: #fff;
            padding: 8px 16px; border-radius: 4px; z-index: 9999;
            font-family: Roboto, Arial, sans-serif; font-size: 14px;
            pointer-events: none; transition: opacity 0.3s;
        `;
        const container = document.querySelector('#movie_player') || document.body;
        container.appendChild(toast);
    }

    toast.textContent = `Skipped segment: ${type} (Gemini AI)`;
    toast.style.opacity = '1';

    clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

// --- Отрисовка UI ---

function clearMarkers() {
    const existingContainers = document.querySelectorAll('.rskip-marker-container');
    existingContainers.forEach(el => el.remove());
}

function drawMarkers() {
    // Ждем пока загрузится таймлайн плеера
    const checkTimeline = setInterval(() => {
        const progressBar = document.querySelector('.ytp-progress-list');
        const videoElement = document.querySelector('video');

        if (progressBar && videoElement && videoElement.duration > 0) {
            clearInterval(checkTimeline);

            const duration = videoElement.duration;
            clearMarkers();

            // Создаем наш собственный контейнер поверх прогресс-бара
            const container = document.createElement('div');
            container.className = 'rskip-marker-container';
            container.style.cssText = `
                position: absolute; top: 0; left: 0;
                width: 100%; height: 100%; pointer-events: none; z-index: 35;
            `;

            currentTimings.forEach(t => {
                const styleDef = MARKER_STYLES[t.type];
                if (!styleDef) return;

                const startPercent = (t.start / duration) * 100;

                const marker = document.createElement('div');

                if (styleDef.type === 'segment') {
                    // Рисуем полосу (заливку региона)
                    const endPercent = (t.end / duration) * 100;
                    const widthPercent = endPercent - startPercent;

                    marker.style.cssText = `
                        position: absolute; left: ${startPercent}%; 
                        width: ${widthPercent}%; height: ${styleDef.height};
                        background-color: ${styleDef.color};
                    `;
                } else if (styleDef.type === 'point') {
                    // Рисуем точку (SVG-иконку над таймлайном)
                    marker.innerHTML = styleDef.icon;
                    marker.style.cssText = `
                        position: absolute; left: calc(${startPercent}% - ${parseInt(styleDef.size) / 2}px); 
                        bottom: 12px; /* Чуть выше линии */
                        display: flex; justify-content: center; align-items: center;
                        filter: drop-shadow(0px 0px 2px rgba(0,0,0,0.8));
                    `;
                }

                // Добавим тултип при наведении (нужно вернуть pointer-events на метку)
                marker.style.pointerEvents = 'auto';
                marker.title = `[Gemini] ${t.type} (${formatTime(t.start)})`;

                container.appendChild(marker);
            });

            progressBar.appendChild(container);
            console.log("[RSKIP YouTube] Метки успешно отрисованы.");
        }
    }, 1000);
}

// Утилита
function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}
