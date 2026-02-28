#!/usr/bin/env python3
"""
Native Messaging host для youtube-reklama-skip.
Принимает JSON-запрос через stdin, вызывает gemini-cli, возвращает результат через stdout.
Протокол: 4 байта длины (little-endian) + JSON payload.
"""

import sys
import json
import struct
import asyncio
import traceback


def read_message():
    """Читает одно сообщение из stdin по протоколу Chrome Native Messaging."""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length or len(raw_length) < 4:
        return None
    length = struct.unpack('=I', raw_length)[0]
    data = sys.stdin.buffer.read(length)
    return json.loads(data.decode('utf-8'))


def send_message(msg):
    """Отправляет одно сообщение в stdout по протоколу Chrome Native Messaging."""
    encoded = json.dumps(msg, ensure_ascii=False).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('=I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


async def handle_analyze(prompt, model):
    """Вызывает gemini-cli для анализа."""
    from gemini_cli.client import ask
    response_text = await ask(prompt, model=model)

    # Извлекаем JSON-массив из ответа (Gemini может добавить лишний текст)
    start_idx = response_text.find('[')
    end_idx = response_text.rfind(']')
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        raise ValueError(f"Ответ ИИ не содержит JSON-массив: {response_text[:200]}")

    data = json.loads(response_text[start_idx:end_idx + 1])
    if not isinstance(data, list):
        raise ValueError("Ответ ИИ не является массивом")
    return data


def main():
    """Главный цикл: читаем запрос, обрабатываем, отправляем ответ."""
    sys.stderr.write("[RSKIP Host] Native host запущен.\n")
    sys.stderr.flush()

    while True:
        message = read_message()
        if message is None:
            break

        sys.stderr.write(f"[RSKIP Host] Получен запрос: {message.get('action', '?')}\n")
        sys.stderr.flush()

        if message.get('action') == 'analyze':
            prompt = message.get('prompt', '')
            model = message.get('model', 'pro')

            try:
                data = asyncio.run(handle_analyze(prompt, model))
                send_message({'success': True, 'data': data})
            except Exception as e:
                sys.stderr.write(f"[RSKIP Host] Ошибка: {traceback.format_exc()}\n")
                sys.stderr.flush()
                send_message({'success': False, 'error': str(e)})
        elif message.get('action') == 'ping':
            send_message({'success': True, 'status': 'ok'})
        else:
            send_message({'success': False, 'error': f"Unknown action: {message.get('action')}"})


if __name__ == '__main__':
    main()
