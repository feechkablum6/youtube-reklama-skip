#!/bin/bash
# Устанавливает Native Messaging host для youtube-reklama-skip
# Использование: ./install.sh <extension-id>

set -e

HOST_NAME="com.rskip.gemini"
EXT_ID="$1"

if [ -z "$EXT_ID" ]; then
    echo "Использование: $0 <extension-id>"
    echo "Extension ID можно найти в chrome://extensions/ (включите режим разработчика)"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$SCRIPT_DIR/gemini_host.py"

if [ ! -f "$HOST_SCRIPT" ]; then
    echo "ОШИБКА: $HOST_SCRIPT не найден"
    exit 1
fi

chmod +x "$HOST_SCRIPT"

# Проверяем, что gemini-cli установлен
if ! python3 -c "from gemini_cli.client import ask" 2>/dev/null; then
    echo "ПРЕДУПРЕЖДЕНИЕ: gemini-cli не установлен. Установите: pip install -e /path/to/gemini-cli"
fi

# Формируем манифест
MANIFEST='{
  "name": "'$HOST_NAME'",
  "description": "Native messaging host for YouTube Reklama Skip",
  "path": "'$HOST_SCRIPT'",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://'"$EXT_ID"'/"]
}'

# Устанавливаем для всех вариантов Chrome/Chromium
TARGETS=(
    "$HOME/.config/google-chrome/NativeMessagingHosts"
    "$HOME/.config/google-chrome-beta/NativeMessagingHosts"
    "$HOME/.config/chromium/NativeMessagingHosts"
)

INSTALLED=0
for DIR in "${TARGETS[@]}"; do
    if [ -d "$(dirname "$DIR")" ]; then
        mkdir -p "$DIR"
        echo "$MANIFEST" > "$DIR/$HOST_NAME.json"
        echo "✓ Установлен: $DIR/$HOST_NAME.json"
        INSTALLED=$((INSTALLED + 1))
    fi
done

if [ "$INSTALLED" -eq 0 ]; then
    echo "ОШИБКА: Не найдена ни одна установка Chrome/Chromium"
    exit 1
fi

echo ""
echo "Готово! Перезапустите Chrome для применения изменений."
