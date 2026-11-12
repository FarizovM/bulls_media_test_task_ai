# Інструкції для coding agents

## Про проєкт

Це внутрішній інструмент підтримки для первинного розгляду запитів на повернення. Backend — NestJS на Fastify з Prisma ORM; frontend — Vue 3, TypeScript і Vite. Стандартний `docker compose up --build` підіймає PostgreSQL, виконує міграції, seed і тести в контейнері підготовки, а потім запускає API та frontend у Docker.

## Правила для всіх змін

- Вважай запити клієнтів і відповіді моделі недовіреними даними. Модель може лише запропонувати статус; сервер перевіряє замовлення, політику, суму та остаточний статус.
- Не додавай платіжні дії або твердження, що кошти переказані: цей застосунок лише фіксує рішення й створює тікет.
- Не передавай OpenAI ключі, OIDC секрети чи інші секрети у frontend, репозиторій, приклади або логи. Не логуй повний текст звернення. Для prompt-injection аудиту зберігай лише дозволені метадані.
- Зберігай production fail-closed поведінку: auth bypass дозволений тільки для локальної розробки; API перевіряє OIDC issuer, audience і scope.
- Записи тікетів мають бути ідемпотентними. При зміні HTTP-входу синхронно онови NestJS DTO/class-validator, frontend API-типи й документацію; для відповідей агента та інструментів зберігай Zod-валідацію.
- Зміни схеми PostgreSQL оформлюй новою SQL-міграцією у `backend/prisma/migrations/` та синхронізуй її з `backend/prisma/schema.prisma`. Не редагуй стару застосовану міграцію для зміни існуючої бази.
- Текст інтерфейсу має бути українською. Зберігай доступність, адаптивність і підтримку `prefers-reduced-motion`.
- Оновлюй README або `docs/`, якщо змінилися запуск, env-параметри, API, міграції чи межі безпеки.

## Структура

- `backend/src/agent/` — HTTP-контролер, оркестратор, guardrails, промпти й Zod-схеми.
- `backend/src/tools/` — серверні інструменти та детерміновані бізнес-перевірки.
- `backend/src/auth/` — перевірка OIDC access token і scope.
- `backend/src/database/` та `backend/prisma/` — Prisma Client, PostgreSQL і версійована схема.
- `backend/src/observability/` — трасування, повтори запитів і безпечний журнал подій.
- `frontend/src/services/` — HTTP API та OIDC клієнт.
- `frontend/src/App.vue`, `style.css`, `ui-polish.css` — український інтерфейс і стилі.
- `docs/agent-orchestration.md` — пояснення послідовності роботи агента.

## Команди

- `docker compose up --build` — рекомендований запуск усього застосунку в Docker; підготовка БД і тести йдуть перед API та frontend.
- `bun run dev` — альтернативний запуск API та frontend на хості з PostgreSQL у Docker.
- `bun run build` — локальна збірка. Для production Compose обов’язково задає `VITE_REQUIRE_OIDC=true` і параметри OIDC.
- `bun run test` — backend unit та integration тести.
- `bun run db:migrate` — застосувати Prisma-міграції до локальної БД із `DATABASE_URL`.
- `bun run db:seed` — ідемпотентно заповнити демо-замовлення.

Коли змінюєш поведінку або контракти, запускай відповідні перевірки та точно зазначай у відповіді, що було запущено й що пройшло. Не стверджуй, що зовнішні OIDC, OpenAI чи production PostgreSQL інтеграції перевірені без доступу до відповідних середовищ.
