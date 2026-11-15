# Інструкції для backend agents

- Використовуй NestJS залежності через constructor injection. Контролери відповідають за HTTP і валідацію; оркестратор визначає послідовність; `ToolsService` виконує серверні інструменти та правила.
- `TriageRequestDto` з class-validator задає HTTP-вхід, а Zod-схеми у `src/agent/schemas.ts` — контракти agent/tool-відповідей. Не довіряй параметрам tool call моделі: валідуй їх Zod і самостійно додавай перевірені order/policy факти.
- Остаточне рішення про повернення визначає backend. Не додавай інструмент, що здійснює платіж, без окремого узгодженого завдання та контрольованого approval flow.
- Зберігай OIDC guard, scope-перевірки, rate limits, обмеження тіла запиту, idempotency та санітизацію помилок. Не вмикай auth bypass у production.
- Prompt-injection події логуй тільки через `SecurityAuditService`. Не записуй prompt або інші сирі клієнтські дані в stdout чи `security_events`.
- Запити до PostgreSQL виконуй через `PrismaService` / `DatabaseService`. Зміни моделей описуй у `prisma/schema.prisma` і новою SQL-міграцією в `prisma/migrations/`; оновлюй runtime role grants у README, якщо потрібні нові права.
- Зовнішні виклики мають мати тайм-аут, контрольовану retry-поведінку та безпечний fallback. Не повертай сирі provider errors клієнту.
- Нову поведінку покривай тестами у `test/`; backend перевіряється командою `bun run test` з кореня.
