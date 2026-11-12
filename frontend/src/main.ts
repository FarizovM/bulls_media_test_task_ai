import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import './ui-polish.css';
import { completeSignIn } from './services/auth';

async function bootstrap() {
  await completeSignIn();
  createApp(App).mount('#app');
}

void bootstrap().catch(() => {
  const root = document.querySelector<HTMLDivElement>('#app');
  if (root) root.textContent = 'Не вдалося завершити вхід. Онови сторінку або звернися до адміністратора.';
});
