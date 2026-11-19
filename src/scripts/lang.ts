import { applyLanguageChoice } from '../lib/i18n';

export function bindLanguageSwitch(): void {
  const root = document.documentElement;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-set-lang]')) {
    button.addEventListener('click', () => {
      const next = button.dataset.setLang ?? '';
      const choice = applyLanguageChoice(next, location.protocol === 'https:');
      if (!choice || root.lang === choice.lang) return;
      root.lang = choice.lang;
      document.cookie = choice.cookie;
      for (const peer of document.querySelectorAll<HTMLButtonElement>('[data-set-lang]')) {
        peer.setAttribute('aria-pressed', peer.dataset.setLang === choice.locale ? 'true' : 'false');
      }
      location.reload();
    });
  }
}
