import { mount } from './main.js';

const root = document.querySelector('[data-chess-stage]');
if (root) {
  try {
    if (!mount(root)) root.classList.add('is-fallback');
  } catch (e) {
    console.error(e);
    root.classList.add('is-fallback');
  }
}
