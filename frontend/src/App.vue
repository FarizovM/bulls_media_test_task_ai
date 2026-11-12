<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  getOrders,
  getScenarios,
  triage,
  type Order,
  type Scenario,
  type TriageResponse,
  type TraceEvent,
} from './services/api';
import { authEnabled, signOut } from './services/auth';

const scenarios = ref<Scenario[]>([]);
const orders = ref<Order[]>([]);
const selectedScenario = ref<string>('happy-path');
const message = ref('У замовленні #ORD-1001 розбилася чашка. Прошу повернути кошти.');
const result = ref<TriageResponse | null>(null);
const loading = ref(false);
const error = ref('');
const dataReady = ref(false);
let retryableSubmission: { message: string; idempotencyKey: string } | null = null;

const statusLabels: Record<string, string> = {
  APPROVED_AUTO_REFUND: 'Повернення схвалено автоматично',
  REJECTED_BY_POLICY: 'Відмовлено за правилами',
  ESCALATED_TO_HUMAN: 'Передано фахівцю',
  MISSING_INFORMATION: 'Потрібні уточнення',
  REFUSED_GUARDRAIL: 'Запит відхилено',
};

const statusClass = computed(() => result.value?.decision.status.toLowerCase().replaceAll('_', '-') ?? '');
const stageLabels: Record<TraceEvent['stage'], string> = {
  GUARDRAIL: 'Перевірка запиту',
  PLANNING: 'Планування агента',
  TOOL_CALL: 'Виклик інструмента',
  TOOL_RESULT: 'Результат інструмента',
  ERROR_RETRY: 'Повтор після помилки',
  FINAL_OUTPUT: 'Фінальна відповідь',
};
const toolLabels: Record<string, string> = {
  get_order_details: 'Пошук замовлення',
  search_return_policy: 'Пошук правил повернення',
  create_resolution_ticket: 'Створення тікета',
  'OpenAI Responses API': 'Запит до моделі OpenAI',
};
const traceTitle = (event: TraceEvent) => event.toolName ? (toolLabels[event.toolName] ?? event.toolName) : stageLabels[event.stage];

onMounted(async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      scenarios.value = await getScenarios();
      if (!authEnabled) orders.value = await getOrders();
      dataReady.value = true;
      return;
    } catch {
      if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  error.value = 'API недоступний. Запусти бекенд і онови сторінку.';
});

function useScenario(scenario: Scenario) {
  selectedScenario.value = scenario.id;
  message.value = scenario.message;
  result.value = null;
  error.value = '';
}

async function runAgent() {
  loading.value = true;
  error.value = '';
  result.value = null;
  try {
    if (!retryableSubmission || retryableSubmission.message !== message.value) {
      retryableSubmission = { message: message.value, idempotencyKey: crypto.randomUUID() };
    }
    result.value = await triage(message.value, retryableSubmission.idempotencyKey);
    retryableSubmission = null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : '';
    error.value = /fetch|network/i.test(detail)
      ? 'Не вдалося зв’язатися з бекендом. Переконайся, що сервер запущений.'
      : detail || 'Під час запуску агента сталася помилка.';
  } finally {
    loading.value = false;
  }
}

async function copyJson() {
  if (!result.value) return;
  await navigator.clipboard.writeText(JSON.stringify(result.value, null, 2));
}

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('uk-UA').format(new Date(value));
}

function formatUsd(value: number) {
  return new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'USD' }).format(value);
}
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <a class="brand" href="#" aria-label="Лабораторія агентів Bulls Media">
        <span class="brand-mark">B</span>
        <span class="brand-copy"><strong>BULLS MEDIA</strong><small>ЛАБОРАТОРІЯ ШІ</small></span>
      </a>
      <div class="topbar-right">
        <span class="environment-pill"><i></i> {{ authEnabled ? 'ЗАХИЩЕНЕ СЕРЕДОВИЩЕ' : 'ЛОКАЛЬНЕ СЕРЕДОВИЩЕ' }}</span>
        <button v-if="authEnabled" class="auth-action" type="button" @click="signOut">Вийти</button>
        <span class="avatar">BM</span>
      </div>
    </header>

    <main class="workspace">
      <section class="intro-row">
        <div>
          <div class="eyebrow"><span class="eyebrow-line"></span> ПІДТРИМКА КЛІЄНТІВ / ДЕМО АГЕНТА</div>
          <h1>Обробка запитів на повернення</h1>
          <p class="intro-copy">Агент перевіряє замовлення, читає правила та готує рішення для служби підтримки.</p>
        </div>
        <div class="flow-hint" aria-label="Послідовність роботи агента">
          <span>Перевірка</span><b>→</b><span>Інструменти</span><b>→</b><span>Рішення</span>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="panel request-panel">
          <div class="panel-heading">
            <div><span class="section-kicker">01 / ЗАПИТ</span><h2>Звернення клієнта</h2></div>
            <span class="step-icon">✳</span>
          </div>

          <div class="field-label-row"><label for="request">ПОВІДОМЛЕННЯ</label><span>{{ message.length }} / 2 000</span></div>
          <textarea id="request" v-model="message" maxlength="2000" placeholder="Опиши запит клієнта щодо повернення..."></textarea>

          <div class="scenario-heading"><span>ГОТОВІ СЦЕНАРІЇ</span><span>5 ПРИКЛАДІВ</span></div>
          <div class="scenario-list">
            <button
              v-for="scenario in scenarios"
              :key="scenario.id"
              class="scenario-button"
              :class="{ active: selectedScenario === scenario.id }"
              type="button"
              @click="useScenario(scenario)"
            >
              <span class="scenario-dot"></span>
              <span class="scenario-text"><strong>{{ scenario.title }}</strong><small>{{ scenario.description }}</small></span>
              <span class="scenario-arrow">↗</span>
            </button>
          </div>

          <button class="run-button" :disabled="loading || !message.trim()" type="button" @click="runAgent">
            <span v-if="loading" class="spinner"></span><span v-else class="run-glyph">▶</span>
            {{ loading ? 'Агент працює…' : 'Запустити агента' }}
            <span v-if="!loading" class="run-shortcut">↵</span>
          </button>
          <p class="helper-text">Оплата не виконується. Демо лише фіксує рішення служби підтримки.</p>
        </section>

        <section class="panel result-panel">
          <div class="panel-heading result-heading">
            <div><span class="section-kicker">02 / РЕЗУЛЬТАТ</span><h2>Рішення агента</h2></div>
            <span v-if="result" class="mode-tag" :class="result.mode">{{ result.mode === 'mock' ? 'ДЕМО БЕЗ API' : 'ВИКЛИК ІНСТРУМЕНТА OPENAI' }}</span>
            <span v-else class="pending-tag">ОЧІКУЄ ЗАПИТ</span>
          </div>

          <div v-if="error" class="error-box"><span>!</span>{{ error }}</div>
          <div v-else-if="loading" class="empty-state processing-state" role="status" aria-live="polite">
            <div class="empty-orbit processing-orbit" aria-hidden="true"><span>✳</span></div>
            <strong>Агент аналізує запит…</strong>
            <p>Перевіряю замовлення та правила повернення.</p>
          </div>
          <div v-else-if="!result" class="empty-state">
            <div class="empty-orbit"><span>✳</span></div>
            <strong>{{ dataReady ? 'Готовий перевірити запит' : 'З’єднуємося з агентом…' }}</strong>
            <p>Обери сценарій або напиши повідомлення й запусти процес, щоб побачити кожен крок.</p>
          </div>
          <template v-else>
            <div class="decision-card" :class="statusClass">
              <div class="decision-topline">
                <span class="status-chip"><i></i>{{ statusLabels[result.decision.status] }}</span>
                <span class="decision-time">{{ result.totalDurationMs }} ms</span>
              </div>
              <h3>{{ result.decision.humanReadableSummary }}</h3>
              <div class="decision-facts">
                <div><span>ЗАМОВЛЕННЯ</span><strong>{{ result.decision.orderId ?? '—' }}</strong></div>
                <div><span>ТІКЕТ</span><strong>{{ result.decision.ticketId ?? 'Не створено' }}</strong></div>
                <div><span>ПОВЕРНЕННЯ</span><strong>{{ result.decision.refundAmountUsd === null ? '—' : `$${result.decision.refundAmountUsd.toFixed(2)}` }}</strong></div>
                <div><span>ВЕРСІЯ ПРАВИЛ</span><strong>{{ result.decision.policyVersion ?? '—' }}</strong></div>
              </div>
              <div v-if="result.decision.deterministicOverrideApplied" class="override-note">
                <span>◆</span> Сервер змінив пропозицію агента відповідно до правила політики.
              </div>
            </div>

            <div class="trace-section">
              <div class="subsection-heading"><div><span class="section-kicker">ТРАСУВАННЯ</span><h3>Кроки виконання</h3></div><span>{{ result.traces.length }} КРОКІВ</span></div>
              <div class="trace-list">
                <article v-for="event in result.traces" :key="event.step" class="trace-item">
                  <span class="trace-marker" :class="event.stage.toLowerCase()">{{ String(event.step).padStart(2, '0') }}</span>
                  <div class="trace-content">
                    <div class="trace-title-row"><strong>{{ traceTitle(event) }}</strong><span>{{ event.durationMs }} ms</span></div>
                    <span class="trace-stage">{{ stageLabels[event.stage] }}</span>
                    <details v-if="event.input !== undefined || event.output !== undefined" class="trace-details">
                      <summary>Переглянути дані</summary>
                      <pre>{{ pretty({ input: event.input, output: event.output }) }}</pre>
                    </details>
                  </div>
                </article>
              </div>
            </div>

            <div v-if="result.decision.customerEmailDraft" class="email-draft">
              <div class="subsection-heading"><div><span class="section-kicker">ПОВІДОМЛЕННЯ КЛІЄНТУ</span><h3>Чернетка листа</h3></div><span class="draft-icon">✉</span></div>
              <pre>{{ result.decision.customerEmailDraft }}</pre>
            </div>

            <details class="raw-json">
              <summary><span>Повна відповідь JSON</span><button type="button" @click.prevent.stop="copyJson">Копіювати JSON</button></summary>
              <pre>{{ pretty(result) }}</pre>
            </details>
          </template>
        </section>
      </div>

      <section v-if="!authEnabled" class="orders-panel">
        <div class="orders-title"><div><span class="section-kicker">ДЕМО-ДАНІ / ЛОКАЛЬНА ЗАГЛУШКА</span><h2>Приклади замовлень</h2></div><span class="count-pill">{{ orders.length }} ЗАПИСІВ</span></div>
        <p class="dataset-note">Локальне демо читає JSON із <code>orders.json</code>; production використовує PostgreSQL.</p>
        <div v-if="orders.length" class="orders-table-wrap">
          <table class="orders-table">
            <thead>
              <tr>
                <th scope="col">ЗАМОВЛЕННЯ</th>
                <th scope="col">КЛІЄНТ</th>
                <th scope="col">ТОВАР</th>
                <th scope="col">КАТЕГОРІЯ</th>
                <th scope="col">СУМА</th>
                <th scope="col">ДАТА ПОКУПКИ</th>
                <th scope="col">ДНІВ ВІД ПОКУПКИ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="order in orders" :key="order.orderId">
                <td class="order-id">{{ order.orderId }}</td>
                <td>{{ order.customerName }}</td>
                <td>{{ order.itemName }}</td>
                <td>{{ order.category }}</td>
                <td class="order-amount">{{ formatUsd(order.totalAmountUsd) }}</td>
                <td>{{ formatDate(order.purchasedAt) }}</td>
                <td>{{ order.daysSincePurchase }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="table-placeholder">Демо-дані з’являться після підключення бекенду.</p>
      </section>
      <footer class="page-footer"><span>BULLS MEDIA · ТЕСТОВЕ ЗАВДАННЯ AI DEVELOPER</span><span>Власний оркестратор <i>•</i> PostgreSQL / локальні демо-дані</span></footer>
    </main>
  </div>
</template>

<style scoped>
.auth-action {
  border: 1px solid #e2e6ed;
  border-radius: 7px;
  background: #fff;
  padding: 7px 10px;
  color: #647087;
  font-size: 10px;
  cursor: pointer;
}

.auth-action:hover {
  border-color: #c7ceda;
  color: #1c2433;
}
</style>
