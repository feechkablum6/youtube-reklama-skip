/**
 * Content Script для youtube.com
 * Идентифицирует видео, управляет UI таймлайна, осуществляет перемотку.
 */

console.log("[RSKIP YouTube] Скрипт-инжектор инициализирован.");

// --- Состояние ---
let currentVideoId = null;
let currentTimings = [];
let isVideoParsed = false;
let autoSkipEnabled = true; // TODO: Брать из настроек

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
    chapter: { color: '#00FF00', size: '6px', type: 'point', icon: '📍' }, // Зеленая точка
    highlight: { color: '#FFD700', size: '8px', type: 'point', icon: '⭐' } // Золотая звезда
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
    if (videoElement && currentTimings.length > 0 && autoSkipEnabled) {
        checkAutoSkip(videoElement);
    }
}, 500); // Проверяем 2 раза в секунду

function checkAutoSkip(videoElement) {
    const currentTime = videoElement.currentTime;

    // Ищем сегмент для скипа (из тех, что относятся к сегментам, а не к точкам)
    for (const t of currentTimings) {
        const styleDef = MARKER_STYLES[t.type];

        // Скипаем только 'segment', и только если этот тип разрешен к скипу
        if (styleDef && styleDef.type === 'segment' && AUTO_SKIP_TYPES.includes(t.type)) {
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
                    // Рисуем точку (иконку/метку над таймлайном)
                    marker.textContent = styleDef.icon;
                    marker.style.cssText = `
                        position: absolute; left: calc(${startPercent}% - ${parseInt(styleDef.size) / 2}px); 
                        bottom: 10px; /* Над линией */
                        font-size: 14px; line-height: 1; text-shadow: 0 0 2px #000;
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
