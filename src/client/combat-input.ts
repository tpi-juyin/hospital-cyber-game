/** Activate on each finger's contact, independently of the primary pointer.
 * Native pointer-generated clicks must not activate a second time.
 */
export function bindCombatInput(button: HTMLButtonElement, action: () => void) {
  button.addEventListener('pointerdown', event => {
    if (button.disabled || event.button !== 0) return;
    event.preventDefault();
    action();
  });
  // Keyboard and assistive-technology activation have no physical pointer.
  button.addEventListener('click', event => {
    if (!button.disabled && event.detail === 0 && !(event as PointerEvent).pointerType) action();
  });
  button.addEventListener('contextmenu', event => event.preventDefault());
}
