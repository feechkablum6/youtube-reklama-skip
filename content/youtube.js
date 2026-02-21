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
    sponsor: { color: 'rgba(239, 68, 68, 0.8)', height: '100%', type: 'segment' }, // red-500
    selfpromo: { color: 'rgba(249, 115, 22, 0.8)', height: '100%', type: 'segment' }, // orange-500
    interaction: { color: 'rgba(234, 179, 8, 0.8)', height: '100%', type: 'segment' }, // yellow-500
    outro: { color: 'rgba(100, 116, 139, 0.8)', height: '100%', type: 'segment' }, // slate-500
    preview: { color: 'rgba(14, 165, 233, 0.8)', height: '100%', type: 'segment' }, // sky-500
    greeting: { color: 'rgba(139, 92, 246, 0.8)', height: '100%', type: 'segment' }, // violet-500

    // Точки
    chapter: { color: '#00FF00', size: '14px', type: 'point', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#00FF00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>' }, // Зеленая точка-маркер
    highlight: { color: '#FFD700', size: '14px', type: 'point', icon: '<svg viewBox="0 0 24 24" width="14" height="14" fill="#FFD700" stroke="#FFD700" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>' } // Золотая звезда
};

// Конфигурация того, что мы скипаем автоматически
const AUTO_SKIP_TYPES = ['sponsor', 'selfpromo', 'interaction', 'outro', 'preview', 'greeting'];

// --- Точка входа ---

// YouTube - это SPA (Single Page Application). Следим за навигацией (событие от YouTube)
document.addEventListener('yt-navigate-finish', handleVideoChange);
document.addEventListener('yt-page-data-updated', handleVideoChange);

// Для подстраховки (первичная загрузка). Откладываем старт, чтобы скрипт успел до конца инициализировать переменные через const/let
if (window.location.href.includes('/watch')) {
    setTimeout(handleVideoChange, 50);
}

// Ультимативный запасной вариант: проверяем URL каждую секунду на случай, если события YouTube не сработали
setInterval(() => {
    if (window.location.href.includes('/watch')) {
        handleVideoChange();
    }
}, 1000);

function handleVideoChange() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');

    if (!videoId) return;

    if (currentVideoId !== videoId) {
        currentVideoId = videoId;
        currentTimings = [];
        isVideoParsed = false;

        clearMarkers();
        setStatus('loading', 'Отправлено на анализ в Gemini...');
        requestAnalysis(videoId, window.location.href);
    }
}

// --- UI Уведомления (Тосты) ---

const ICONS = {
    loading: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: rskip-spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`,
    success: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    sparkle: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #a855f7;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`
};

function injectStyles() {
    if (document.getElementById('rskip-styles')) return;
    const style = document.createElement('style');
    style.id = 'rskip-styles';
    style.textContent = `
        @keyframes rskip-spin { 100% { transform: rotate(360deg); } }
        
        #rskip-toast-container {
            position: fixed; bottom: 120px; right: 24px; z-index: 99999;
            display: flex; align-items: center; gap: 12px;
            background: rgba(15, 17, 21, 0.75);
            backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 100px; padding: 12px 18px;
            color: #f8fafc; font-family: 'Inter', 'Roboto', sans-serif; font-size: 14px; font-weight: 500;
            pointer-events: auto; transition: all 0.6s cubic-bezier(0.2, 0.8, 0.2, 1);
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            opacity: 0; transform: translateY(20px) scale(0.95);
        }
        #rskip-toast-container.rskip-visible { opacity: 1; transform: translateY(0) scale(1); }
        
        #rskip-toast-container.rskip-persistent {
            padding: 10px; bottom: 24px; right: 24px; border-radius: 50%;
            background: rgba(15, 17, 21, 0.9); box-shadow: 0 0 20px rgba(168, 85, 247, 0.3);
            border-color: rgba(168, 85, 247, 0.4); cursor: help;
        }
        #rskip-toast-container.rskip-persistent:hover {
            padding: 10px 18px; border-radius: 100px; background: rgba(23, 25, 30, 0.95);
            box-shadow: 0 0 25px rgba(168, 85, 247, 0.5);
        }
        
        #rskip-toast-text {
            white-space: nowrap; overflow: hidden; max-width: 300px;
            transition: max-width 0.5s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.3s ease, margin 0.3s;
        }
        #rskip-toast-container.rskip-persistent #rskip-toast-text {
            max-width: 0; opacity: 0; margin-left: 0; pointer-events: none;
        }
        #rskip-toast-container.rskip-persistent:hover #rskip-toast-text {
            max-width: 300px; opacity: 1; margin-left: 4px; pointer-events: auto;
        }
        
        .rskip-icon-wrapper { display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        
        /* Timelines / Markers */
        .rskip-marker { transition: filter 0.2s, transform 0.2s; cursor: pointer; transform-origin: bottom; }
        .rskip-marker:hover { filter: brightness(1.4) drop-shadow(0 0 6px currentColor); transform: scaleY(1.4); z-index: 1000 !important; }
        
        body.rskip-hovering-marker .ytp-tooltip { display: none !important; opacity: 0 !important; }

        .rskip-tooltip {
            position: absolute; bottom: calc(100% + 12px); left: 50%; transform: translateX(-50%) translateY(10px);
            background: rgba(15, 17, 21, 0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px 16px;
            color: #f8fafc; font-family: 'Inter', 'Roboto', sans-serif; font-size: 13px;
            pointer-events: none; width: max-content; max-width: 320px; white-space: normal; opacity: 0;
            transition: opacity 0.2s, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
            box-shadow: 0 8px 24px rgba(0,0,0,0.6); z-index: 99999; display: flex; flex-direction: column; gap: 4px;
        }
        .rskip-tooltip::after {
            content: ''; position: absolute; top: 100%; left: 50%; margin-left: -6px;
            border-width: 6px; border-style: solid; border-color: rgba(15,17,21,0.95) transparent transparent transparent;
        }
        .rskip-marker:hover .rskip-tooltip { opacity: 1; transform: translateX(-50%) translateY(0); }
        
        .rskip-tt-header { display: flex; align-items: center; gap: 8px; }
        .rskip-tt-type { font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 0.6px; }
        .rskip-tt-time { color: rgba(255,255,255,0.5); font-size: 11px; }
        .rskip-tt-desc { color: #cbd5e1; line-height: 1.5; white-space: normal; font-weight: 400; word-break: break-word; }
        
        /* Skip Toast overlay на плеер */
        #rskip-skip-toast {
            position: absolute; top: 32px; right: 32px;
            background: rgba(15, 17, 21, 0.85); backdrop-filter: blur(12px);
            border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 100px;
            padding: 10px 20px; display: flex; align-items: center; gap: 12px;
            color: #fff; font-family: 'Inter', 'Roboto', sans-serif; font-size: 14px; font-weight: 500;
            pointer-events: none; opacity: 0; transition: all 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
            transform: translateY(-10px); box-shadow: 0 8px 24px rgba(0,0,0,0.5); z-index: 99999;
        }
        #rskip-skip-toast.rskip-visible { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);
}

let toastTimeout = null;

function setStatus(state, message) {
    injectStyles();
    let toast = document.getElementById('rskip-toast-container');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'rskip-toast-container';
        toast.innerHTML = `<div id="rskip-toast-icon" class="rskip-icon-wrapper"></div><div id="rskip-toast-text"></div>`;
        document.body.appendChild(toast);
    }

    const iconEl = toast.querySelector('#rskip-toast-icon');
    const textEl = toast.querySelector('#rskip-toast-text');

    clearTimeout(toastTimeout);
    toast.classList.remove('rskip-persistent', 'rskip-visible');

    // Сбрасываем рендеринг чтобы CSS-переход сработал
    void toast.offsetWidth;
    toast.classList.add('rskip-visible');

    // Удаляем предыдущие обводки ошибки если были
    toast.style.borderColor = '';

    switch (state) {
        case 'loading':
            iconEl.innerHTML = ICONS.loading;
            textEl.textContent = message || 'Анализируем видео...';
            break;
        case 'success':
            iconEl.innerHTML = ICONS.success;
            textEl.textContent = message || 'Анализ завершен';
            toastTimeout = setTimeout(() => {
                iconEl.innerHTML = ICONS.sparkle;
                textEl.textContent = 'AI отслеживает сегменты';
                toast.classList.add('rskip-persistent');
            }, 3000); // через 3 сек сворачиваем в персистентную точку
            break;
        case 'error':
            iconEl.innerHTML = ICONS.error;
            textEl.textContent = message || 'Ошибка';
            toast.style.borderColor = 'rgba(244, 63, 94, 0.4)';
            toastTimeout = setTimeout(() => {
                toast.classList.remove('rskip-visible');
            }, 4000);
            break;
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
        console.log(`[RSKIP YouTube] Получены тайминги: `, message.timings);
        setStatus('success', `Таймлайны расставлены и сохранены. Зон: ${message.timings.length}`);
        currentTimings = message.timings;
        drawMarkers();
    }

    if (message.action === 'rskip_status_update') {
        setStatus(message.isError ? 'error' : 'loading', message.text);
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
                showSkipToast(t.type, t.description);
                return; // Перемотали, выходим из цикла
            }
        }
    }
}

function showSkipToast(type, description = "") {
    let toast = document.getElementById('rskip-skip-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'rskip-skip-toast';
        const container = document.querySelector('#movie_player') || document.body;
        if (container) container.appendChild(toast);
    }

    const textDesc = description ? description : type.toUpperCase();
    toast.innerHTML = `${ICONS.sparkle} <span>Скип: <b>${textDesc}</b></span>`;

    // Сброс анимации
    toast.classList.remove('rskip-visible');
    void toast.offsetWidth;
    toast.classList.add('rskip-visible');

    clearTimeout(toast.timeoutId);
    toast.timeoutId = setTimeout(() => { toast.classList.remove('rskip-visible'); }, 3000);
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
                marker.className = 'rskip-marker';

                const desc = t.description || 'ИИ пометил этот момент без описания.';
                const tooltipHtml = `
                    <div class="rskip-tooltip">
                        <div class="rskip-tt-header">
                            <span class="rskip-tt-type" style="color: ${styleDef.color}">${t.type}</span>
                            <span class="rskip-tt-time">${formatTime(t.start)}${t.end ? ' - ' + formatTime(t.end) : ''}</span>
                        </div>
                        <div class="rskip-tt-desc">${desc}</div>
                    </div>
                `;

                if (styleDef.type === 'segment') {
                    // Рисуем полосу (заливку региона)
                    const endPercent = (t.end / duration) * 100;
                    const widthPercent = endPercent - startPercent;

                    marker.style.cssText = `
                        position: absolute; left: ${startPercent}%; 
                        width: ${widthPercent}%; height: ${styleDef.height};
                        background-color: ${styleDef.color};
                    `;
                    marker.innerHTML = tooltipHtml;
                } else if (styleDef.type === 'point') {
                    // Рисуем точку (SVG-иконку над таймлайном)
                    marker.style.cssText = `
                        position: absolute; left: calc(${startPercent}% - ${parseInt(styleDef.size) / 2}px); 
                        bottom: 12px; /* Чуть выше линии */
                        display: flex; justify-content: center; align-items: center;
                    `;
                    marker.innerHTML = styleDef.icon + tooltipHtml; // SVG point + Tooltip
                }

                // Добавим тултип при наведении (нужно вернуть pointer-events на метку)
                marker.style.pointerEvents = 'auto';
                
                // Перехватываем hover чтобы скрыть дефолтный тултип Youtube
                marker.addEventListener('mouseenter', () => {
                    document.body.classList.add('rskip-hovering-marker');
                });
                marker.addEventListener('mouseleave', () => {
                    document.body.classList.remove('rskip-hovering-marker');
                });

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
