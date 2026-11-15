import { Injectable } from '@nestjs/common';

export interface GuardrailResult {
  accepted: boolean;
  reasonCode: string;
  message: string;
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /system\s+prompt|developer\s+message/i,
  /bypass\s+(the\s+)?rules?|override\s+(the\s+)?policy/i,
  /reveal\s+(your\s+)?(hidden\s+)?instructions?/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /ігноруй\s+(усі\s+)?(попередні|системні)\s+інструкц/i,
  /обійди\s+(правила|політику)/i,
];

const REFUND_TERMS = /refund|return|money back|broken|damaged|defect|faulty|not working|chargeback|order|поверн|відшкоду|грош|брак|зламан|не працює|замовлен|товар|рефанд/i;

@Injectable()
export class GuardrailsService {
  validate(message: string): GuardrailResult {
    const normalized = message.trim();

    if (normalized.length < 5) {
      return {
        accepted: false,
        reasonCode: 'INVALID_INPUT_TOO_SHORT',
        message: 'Опиши запит на повернення або відшкодування трохи детальніше.',
      };
    }

    if (normalized.length > 2000) {
      return {
        accepted: false,
        reasonCode: 'INVALID_INPUT_TOO_LONG',
        message: 'Запит задовгий. Скороти його до 2 000 символів.',
      };
    }

    if (INJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
      return {
        accepted: false,
        reasonCode: 'PROMPT_INJECTION_DETECTED',
        message: 'Я можу допомогти лише із запитами на повернення коштів за правилами магазину.',
      };
    }

    if (!REFUND_TERMS.test(normalized)) {
      return {
        accepted: false,
        reasonCode: 'OUT_OF_SCOPE_REQUEST',
        message: 'Цей помічник обробляє лише повернення замовлень і запити на відшкодування.',
      };
    }

    return {
      accepted: true,
      reasonCode: 'INPUT_ACCEPTED',
      message: 'Запит пройшов початкові перевірки.',
    };
  }
}
