/**
 * Логика UI настроек Popup
 */

// Константы категорий с их цветами и описаниями
const CATEGORIES = [
    { id: 'sponsor', name: 'Спонсорская реклама', desc: 'Платные интеграции и продукты', color: '#ff0000' },
    { id: 'selfpromo', name: 'Самореклама / Мерч', desc: 'Собственные товары, донаты', color: '#ffa500' },
    { id: 'interaction', name: 'Просьбы подписки', desc: 'Лайки, колокольчики, шеры', color: '#ffff00' },
    { id: 'outro', name: 'Заставки / Титры', desc: 'Конец видео без информации', color: '#808080' },
    { id: 'preview', name: 'Краткие обзоры', desc: 'Вырезки того, что будет дальше', color: '#00bfff' },
    { id: 'greeting', name: 'Трелеры / Приветствия', desc: 'Пустая болтовня в начале', color: '#a9a9a9' }
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
                    <span class="item-badge" style="background-color: ${cat.color}"></span>
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
        await chrome.storage.local.remove('rskip_cache_v1');
        setTimeout(() => {
            btn.textContent = 'Кэш очищен ✔️';
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
