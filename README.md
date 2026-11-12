# Bulls Media — AI-агент для обробки запитів на повернення

## Контекст проблеми

Це внутрішній інструмент служби підтримки для первинного розгляду запитів на повернення. Система перевіряє звернення, застосовує серверні правила та фіксує рішення в тікеті, який може переглянути фахівець.

## Що робить агент

Агент приймає запит звичайною мовою, перевіряє його, знаходить замовлення, застосовує правила повернення та створює тікет. API повертає типізоване рішення, пояснення й безпечну для інтерфейсу трасу виконання. Production-профіль використовує OIDC для входу та PostgreSQL для замовлень і тікетів.

Агент не переказує кошти, не звертається до платіжного сервісу, не змінює правила й не вигадує дані замовлення. Якщо номера немає або замовлення не знайдено, він просить уточнення й не створює тікет.

## Сценарії

| Сценарій | Приклад | Очікуваний результат |
| --- | --- | --- |
| Пошкоджений товар | ORD-1001 · $45 · придбано 3 дні тому | `APPROVED_AUTO_REFUND` |
| Дороге замовлення | ORD-1002 · $1 200 · придбано 5 днів тому | `ESCALATED_TO_HUMAN` |
| Термін повернення минув | ORD-1003 · придбано 45 днів тому | `REJECTED_BY_POLICY` |
| Немає номера замовлення | Пошкоджений товар без номера | `MISSING_INFORMATION`, без тікета |
| Спроба prompt injection | Прохання проігнорувати правила | `REFUSED_GUARDRAIL`, бізнес-інструменти не запускаються; подія аудиту записується без тексту звернення |

Приклади запитів і результатів збережені у [`examples/scenarios.json`](examples/scenarios.json). Кожен сценарій також можна запустити кнопкою у вебінтерфейсі.

## Архітектура та потік даних

```mermaid
flowchart LR
    UI[Інтерфейс Vue 3] -->|HTTP JSON| API[Контролер NestJS]
    API --> G[Перевірки запиту]
    G --> O[Власний оркестратор]
    O --> OL[Пошук замовлення]
    O --> PS[Пошук правил]
    O --> P[OpenAI tool call або mock-планувальник]
    P --> TA[Перевірка та запис тікета]
    OL --> DB[(PostgreSQL / orders.json dev fixture)]
    PS --> DOC[refund-policy.json + Markdown]
    TA --> DB2[(PostgreSQL / локальна пам’ять)]
    O --> TR[Траса запиту]
    TR --> API
```

Бекенд використовує NestJS і Fastify. Власний оркестратор на TypeScript задає послідовність: перевірити звернення, прочитати замовлення, знайти правило, отримати пропозицію планувальника, перевірити її серверними правилами й сформувати відповідь. OpenAI описує такий обмін у [посібнику з function calling](https://developers.openai.com/api/docs/guides/function-calling); NestJS документує [адаптер Fastify](https://docs.nestjs.com/techniques/performance).

Технічний потік оркестрації описано в [`docs/agent-orchestration.md`](docs/agent-orchestration.md).

## Демо-дані

`backend/src/data/orders.json` — локальна JSON-заглушка з п’ятьма прикладами. Без `DATABASE_URL` застосунок використовує її для розробки, а тікети зберігає в пам’яті. Якщо підключено PostgreSQL, звідти читаються замовлення і туди записуються тікети. Структуровані правила повернення та їхня версія зберігаються у `refund-policy.json`; Markdown-файл містить пояснення для людей.

Production-профіль вимагає PostgreSQL і зупиняється, якщо база або схема недоступні. Запис тікета ідемпотентний за `Idempotency-Key`; у таблиці зберігаються версія політики та ідентифікатор OIDC-користувача, який створив його.

У production таблиця `orders` у PostgreSQL є джерелом замовлень. Репозиторій задає її схему, але не містить синхронізації з конкретною CRM, магазином чи ERP. Перед використанням реальних покупок потрібен довірений імпорт даних, а також аудит і резервне копіювання бази.

Для контейнерного розгортання є окремі [Dockerfile API](backend/Dockerfile), [Dockerfile фронтенду](frontend/Dockerfile) і [production Compose](compose.production.yaml). Конфігурація авторизації фронтенду вбудовується під час його збірки; це публічні параметри OIDC-клієнта, у них не можна передавати секрети.

Задай production змінні в secret manager або локальному `.env`, потім перевір Compose через `docker compose -f compose.production.yaml config -q`. Для міграцій задай окремий привілейований `MIGRATION_DATABASE_URL` і виконай `docker compose -f compose.production.yaml --profile migration run --rm migrate`. API використовує окремий обмежений `DATABASE_URL`. Після міграції запусти `docker compose -f compose.production.yaml up --build -d`. Compose не відкриває API назовні й публікує frontend лише на loopback `127.0.0.1:8080`; TLS заверши на ingress/load balancer і ввімкни там HSTS.

## Локальний запуск

Потрібні Node.js 22.12+ і npm 10+.

```bash
npm install
# або: bun install
```

Скопіюй `.env.example` у `.env`. За замовчуванням `MOCK_LLM=true`, а `AUTH_BYPASS_DEV=true` дозволяє локальну розробку без OIDC. Ці параметри дозволені лише поза production. Запусти застосунок із кореня репозиторію:

```bash
npm run dev
# або: bun run dev
```

Відкрий <http://localhost:5173>. API бекенду доступний на <http://localhost:3000>.

Для локальної PostgreSQL встанови Docker Desktop, задай `POSTGRES_PASSWORD` і `DATABASE_URL` у `.env`, потім виконай `npm run db:up`. Новий контейнер створює схему та заповнює приклади замовлень; міграцію також можна запустити командою `npm run db:migrate`. Наприклад: `DATABASE_URL=postgresql://bulls_media:пароль@localhost:5432/bulls_media` (спецсимволи в паролі потрібно URL-кодувати). Без `DATABASE_URL` локальний режим використовує JSON і пам’ять процесу.

Якщо запуск повідомляє `EADDRINUSE` для портів `3000` або `5173`, інший процес уже використовує їх. Зупини попередній `npm run dev` чи `bun run dev` комбінацією **Ctrl+C** у його терміналі, потім запусти команду знову. Щоб знайти процеси, які слухають ці порти, у PowerShell виконай:

```powershell
Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 3000, 5173 } |
  Select-Object LocalPort, OwningProcess
```

Перевір процес за `OwningProcess` командою `Get-Process -Id 1234`, замінивши `1234` на його номер, перш ніж зупиняти його.

### Налаштування OpenAI API

Я не можу створити ключ у твоєму OpenAI акаунті. Для локальної розробки створи власний ключ у потрібному API-проєкті: [OpenAI Platform → API Keys](https://platform.openai.com/api-keys) → **Create new secret key**. Скопіюй його одразу й збережи лише локально у `.env`:

```dotenv
MOCK_LLM=false
OPENAI_API_KEY=встав_свій_ключ_сюди
OPENAI_MODEL=gpt-6-luna
```

Не додавай ключ у Git, браузерний код або повідомлення. Ключ показується лише під час створення; за потреби згенеруй новий і відклич старий. API-запити можуть мати окрему оплату — перевір витрати й ліміти свого проєкту перед запуском. Докладніше: [офіційна документація про ключі та сервісні акаунти](https://developers.openai.com/api/docs/guides/api-keys).

### Production-конфігурація

Production запуск вимагає `NODE_ENV=production`, `MOCK_LLM=false`, ключ OpenAI, TLS PostgreSQL, HTTPS origin фронтенду та OIDC. Встанови секрети в secret manager платформи розгортання, а не в репозиторії:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
AUTH_BYPASS_DEV=false
FRONTEND_ORIGINS=https://support.example.com
DATABASE_URL=postgresql://...
DATABASE_SSL=true
DATABASE_POOL_MAX=10
DATABASE_STATEMENT_TIMEOUT_MS=5000
DATABASE_QUERY_TIMEOUT_MS=7000
OIDC_ISSUER=https://identity.example.com/tenant/v2.0
OIDC_AUDIENCE=api://bulls-media-agent
OIDC_JWKS_URL=https://identity.example.com/tenant/discovery/v2.0/keys
VITE_OIDC_AUTHORITY=https://identity.example.com/tenant/v2.0
VITE_OIDC_CLIENT_ID=bulls-media-dashboard
VITE_OIDC_SCOPE=openid agent:read agent:triage
OIDC_ORIGIN=https://identity.example.com
MOCK_LLM=false
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-6-luna
```

OIDC-клієнт фронтенду має використовувати Authorization Code Flow з PKCE. Зареєструй redirect URI `https://support.example.com/auth/callback` та надай scopes `agent:read` і `agent:triage`. Звичайний `bun run build` збирає локальне демо без OIDC. Production Compose передає `VITE_REQUIRE_OIDC=true`, тому для production-збірки потрібні `VITE_OIDC_AUTHORITY`, `VITE_OIDC_CLIENT_ID`, `VITE_OIDC_SCOPE` і `OIDC_ORIGIN` (точний HTTPS origin OIDC authority). API перевіряє підпис JWT, issuer, audience та потрібний scope за довіреним HTTPS JWKS endpoint.

API має доступ `SELECT` до замовлень і `SELECT`/`INSERT` до тікетів; migration role має окремі DDL-права. API надає `GET /api/health/live` для liveness та `GET /api/health/ready` для перевірки PostgreSQL. Production Compose обмежує кожного OIDC-користувача до 30 запитів за хвилину та має глобальний аварійний ліміт на екземпляр; додай також спільний ліміт на ingress/API gateway для багатоконтейнерного розгортання.

Після першої міграції надай runtime-ролі лише потрібні права (виконай від імені адміністратора бази, замінивши назву БД і пароль):

```sql
CREATE ROLE bulls_agent LOGIN PASSWORD 'use-a-secret-manager-generated-password';
GRANT CONNECT ON DATABASE bulls_media TO bulls_agent;
GRANT USAGE ON SCHEMA public TO bulls_agent;
GRANT SELECT ON TABLE orders, resolution_tickets TO bulls_agent;
GRANT INSERT ON TABLE resolution_tickets, security_events TO bulls_agent;
```

Не запускай API під migration-роллю. Якщо PostgreSQL розміщено в іншій схемі, адаптуй `search_path` або кваліфікуй таблиці у запитах.

Кожен prompt injection, який спрацював наявними guardrails, записується як `PROMPT_INJECTION_DETECTED` у `security_events` і як структурований JSON у stdout. Журнал містить request ID, OIDC subject, код детектора й довжину повідомлення — сам текст повідомлення не зберігається. Runtime-роль має лише `INSERT`; читання журналу залишай адміністраторам/аудиторам. Для локального запуску без PostgreSQL подія є лише у stdout бекенду. Налаштуй строк зберігання журналу відповідно до політики приватності організації.

### API-маршрути

- `GET /api/agent/scenarios` — п’ять сценаріїв; вимагає `agent:read`.
- `GET /api/agent/orders` — до 100 локальних прикладів; production-маршрут вимкнений, щоб не відкривати списковий доступ до клієнтських замовлень.
- `POST /api/agent/triage` — приймає `{"message":"У замовленні ORD-1001 пошкодився товар. Прошу повернути кошти."}`; вимагає `agent:triage` та UUID у `Idempotency-Key`. Для повтору тієї самої операції використовуй той самий ключ; для нового запиту згенеруй інший.

## Перевірка та тести

Запусти тести з кореня репозиторію:

```bash
npm test
# або: bun run test
```

Unit-тести перевіряють guardrails, повторні спроби та детерміновані правила тікета. Integration-тест надсилає запит через Fastify/NestJS і перевіряє JSON-відповідь та послідовність інструментів. Для тестів достатньо mock-режиму, ключ OpenAI не потрібен.

Для ручного огляду запусти застосунок, вибери сценарій і натисни **«Запустити агента»**. Розгорни кроки траси та повну JSON-відповідь. Дороге й прострочене замовлення мають показати, що сервер перевизначив пропозицію; запити без номера та prompt injection не повинні створювати тікет.

## Приклад запиту й очікуваної відповіді

```json
{
  "input": { "message": "У замовленні #ORD-1001 розбилася чашка. Прошу повернути кошти." },
  "expected": {
    "status": "APPROVED_AUTO_REFUND",
    "orderId": "ORD-1001",
    "refundAmountUsd": 45,
    "toolCalls": [
      "get_order_details",
      "search_return_policy",
      "create_resolution_ticket"
    ]
  }
}
```

Номер тікета генерується під час запуску. Усі приклади є у [`examples/scenarios.json`](examples/scenarios.json), а фактична JSON-траса відображається в інтерфейсі.

## Компроміси, обмеження та наступні кроки

- Без `DATABASE_URL` дані й тікети зберігаються локально; production вимагає PostgreSQL, міграцій та ідемпотентного запису тікетів.
- Пошук політики працює за простими словами, а не через семантичний пошук. Ліміти й остаточне рішення перевіряються бекендом.
- Guardrails доповнюють бізнес-правила, але самі по собі не блокують усі prompt injection атаки. Остаточний статус визначає серверний код; модель не може передати довільний текст у пояснення тікета.
- Локальні приклади замовлень лишаються JSON-даними. У production таблицю PostgreSQL має наповнювати авторитетне джерело; інтеграцію з конкретною системою ще потрібно визначити й підключити.
- Платіжної інтеграції немає: застосунок створює рішення й тікет, але не переказує кошти. Автоматичне рішення не є виконаною фінансовою операцією.
- Багатокористувацьке/багатотенантне розмежування доступу, централізовані аудит-логи, резервне копіювання, моніторинг витрат і спільний rate limit мають бути налаштовані відповідно до платформи розгортання.

## Використання в реальному бізнесі

Це тестове завдання з production-профілем безпеки та зберігання. Репозиторій не підключений до реального каталогу замовлень, служби підтримки чи платіжної системи; перед обслуговуванням реальних клієнтів потрібні відповідні інтеграції та бізнес-затвердження.

Такий процес могли б адаптувати:

1. Служби підтримки інтернет-магазинів для первинного розгляду повернень і пошкоджених товарів.
2. Маркетплейси для маршрутизації спорів між покупцями та продавцями.
3. Сервіси підписок для розгляду скасувань і коригувань оплати.

Для підключення до реального бізнесу власник системи має надати OIDC tenant/client settings, підключити синхронізацію справжніх замовлень у PostgreSQL, визначити строк зберігання даних і моніторинг, затвердити чинну політику повернення та вирішити, хто підтверджує рішення. Платіжна операція потребує окремої контрольованої інтеграції й не виконується цим застосунком.
