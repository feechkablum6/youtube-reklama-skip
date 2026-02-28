/**
 * Логика UI настроек Popup
 */

// Константы категорий с их цветами и описаниями
const CATEGORIES = [
    { id: 'sponsor', name: 'Спонсорская реклама', desc: 'Платные интеграции и продукты', color: '#ef4444', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"></path><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"></path></svg>' },
    { id: 'selfpromo', name: 'Самореклама / Мерч', desc: 'Собственные товары, донаты', color: '#f97316', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>' },
    { id: 'interaction', name: 'Просьбы подписки', desc: 'Лайки, колокольчики, шеры', color: '#eab308', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"></path><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"></path></svg>' },
    { id: 'outro', name: 'Заставки / Титры', desc: 'Конец видео без информации', color: '#64748b', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>' },
    { id: 'preview', name: 'Краткие обзоры', desc: 'Вырезки того, что будет дальше', color: '#0ea5e9', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><line x1="20" x2="8.12" y1="4" y2="15.88"></line><line x1="14.47" x2="20" y1="14.48" y2="20"></line><line x1="8.12" x2="12" y1="8.12" y2="12"></line></svg>' },
    { id: 'greeting', name: 'Трейлеры / Приветствия', desc: 'Пустая болтовня в начале', color: '#8b5cf6', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path></svg>' }
];

// Дефолтные настройки
const DEFAULT_SETTINGS = {
    globalAutoSkip: true,
    categories: {
        sponsor: true,
        selfpromo: true,
        interaction: true,
        outro: true,
        preview: false,
        greeting: false
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Инициализация DOM
    renderCategories();

    // 2. Загрузка кэшированных настроек
    const settings = await loadSettings();
    applySettingsToDOM(settings);

    // 3. Подписка на события изменений
    setupListeners();
});

function renderCategories() {
    const container = document.getElementById('categories-container');

    CATEGORIES.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'setting-item';
        item.innerHTML = `
            <div class="setting-info">
                <h3>
                    <span class="category-icon" style="color: ${cat.color};">
                        ${cat.icon}
                    </span>
                    ${cat.name}
                </h3>
                <p>${cat.desc}</p>
            </div>
            <label class="switch">
                <input type="checkbox" id="toggle-${cat.id}" data-category="${cat.id}">
                <span class="slider round"></span>
            </label>
        `;
        container.appendChild(item);
    });
}

function applySettingsToDOM(settings) {
    const globalToggle = document.getElementById('global-skip-toggle');
    globalToggle.checked = settings.globalAutoSkip;

    CATEGORIES.forEach(cat => {
        const toggle = document.getElementById(`toggle-${cat.id}`);
        if (toggle) {
            toggle.checked = settings.categories[cat.id];
            // Визуально отключаем, если глобальный скип выключен
            toggle.disabled = !settings.globalAutoSkip;
            if (!settings.globalAutoSkip) {
                toggle.parentElement.parentElement.style.opacity = '0.5';
            } else {
                toggle.parentElement.parentElement.style.opacity = '1';
            }
        }
    });
}

function setupListeners() {
    // Глобальный переключатель
    document.getElementById('global-skip-toggle').addEventListener('change', async (e) => {
        const isEnabled = e.target.checked;
        const currentSettings = await loadSettings();
        currentSettings.globalAutoSkip = isEnabled;

        await saveSettings(currentSettings);
        applySettingsToDOM(currentSettings);
    });

    // Переключатели категорий
    document.querySelectorAll('.categories-section input[type="checkbox"]').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const catId = e.target.getAttribute('data-category');
            const isEnabled = e.target.checked;

            const currentSettings = await loadSettings();
            currentSettings.categories[catId] = isEnabled;

            await saveSettings(currentSettings);
        });
    });

    // Кнопка очистки кэша
    document.getElementById('clear-cache-btn').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.textContent = 'Очистка...';

        // Получаем все ключи и фильтруем те, что относятся к кэшу (префикс rskip_cache_v1_)
        const allData = await chrome.storage.local.get(null);
        const keysToRemove = Object.keys(allData).filter(k => k.startsWith('rskip_cache_v1_') || k === 'rskip_cache_v1');

        if (keysToRemove.length > 0) {
            await chrome.storage.local.remove(keysToRemove);
        }

        setTimeout(() => {
            btn.innerHTML = 'Кэш очищен <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: text-top; margin-left: 4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            setTimeout(() => btn.textContent = 'Очистить кэш видео', 2000);
        }, 500);
    });
}

// --- Утилиты Storage ---

async function loadSettings() {
    const data = await chrome.storage.local.get('rskip_settings');
    if (!data.rskip_settings) {
        await saveSettings(DEFAULT_SETTINGS);
        return DEFAULT_SETTINGS;
    }
    return data.rskip_settings;
}

async function saveSettings(settings) {
    await chrome.storage.local.set({ 'rskip_settings': settings });
}
