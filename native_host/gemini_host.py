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
import re


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


def strip_markdown_codeblock(text):
    """Убирает markdown-обёртку ```json ... ``` или ``` ... ``` из ответа."""
    # Паттерн: ```json\n...\n``` или ```\n...\n``` (с любым языком или без)
    match = re.search(r'```(?:\w*)\s*\n?(.*?)\n?\s*```', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


MAX_RETRIES = 2
RETRY_PROMPT = "Ты ответил пустым сообщением или не в том формате. Повтори анализ. Выведи СТРОГО валидный JSON-массив тайимингов и больше ничего."


def extract_json_array(text):
    """Извлекает JSON-массив из текста, очищая markdown-обёртки."""
    if not text or not text.strip():
        return None

    cleaned = strip_markdown_codeblock(text)
    start_idx = cleaned.find('[')
    end_idx = cleaned.rfind(']')
    if start_idx == -1 or end_idx == -1 or end_idx <= start_idx:
        return None

    try:
        data = json.loads(cleaned[start_idx:end_idx + 1])
        if isinstance(data, list):
            return data
    except json.JSONDecodeError:
        return None
    return None


async def handle_analyze(prompt, model):
    """Вызывает gemini-cli для анализа с ретраями в том же чате."""
    from gemini_cli.client import chat_session, prepend_prompt

    client, chat = await chat_session(model=model)

    # Первый запрос
    response = await chat.send_message(prepend_prompt(prompt))
    response_text = response.text or ""

    sys.stderr.write(f"[RSKIP Host] Ответ Gemini ({len(response_text)} символов): {response_text[:150]}...\n")
    sys.stderr.flush()

    data = extract_json_array(response_text)
    if data is not None:
        return data

    # Ретраи в том же чате — Gemini видит контекст предыдущего запроса
    for attempt in range(1, MAX_RETRIES + 1):
        sys.stderr.write(f"[RSKIP Host] Пустой/невалидный ответ, ретрай {attempt}/{MAX_RETRIES}...\n")
        sys.stderr.flush()

        response = await chat.send_message(RETRY_PROMPT)
        response_text = response.text or ""

        sys.stderr.write(f"[RSKIP Host] Ретрай {attempt} ответ ({len(response_text)} символов): {response_text[:150]}...\n")
        sys.stderr.flush()

        data = extract_json_array(response_text)
        if data is not None:
            return data

    raise ValueError(f"ИИ не вернул валидный JSON после {MAX_RETRIES + 1} попыток. Последний ответ: {response_text[:300]}")


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
