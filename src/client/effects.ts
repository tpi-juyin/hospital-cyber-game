import type { Role, CombatStrategy } from '../shared/protocol';
const svg = (body: string, viewBox = '0 0 80 80') => `<svg viewBox="${viewBox}" fill="none" stroke="#193246" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const star = '<path d="m40 5 8 24 26-9-15 22 17 19-26-5-10 20-7-24-26 7 17-20-14-20 25 8z" fill="#ffe477"/>';
const sparkles = `<span class="fx-sparkles">${svg(star)}</span>`;
const attackArt = [
  svg('<path d="m7 29-6-7m8 21-7 3m19-30-1-8" stroke="#ffb146"/><path d="M32 39a16 16 0 1 1 4-15l33 15-5 11-9-4-4 8-9-4 5-10z" fill="#ffd45a"/><circle cx="23" cy="24" r="6" fill="#fff8d5"/><path d="m40 31 17 8" stroke="#fff8d5"/>'),
  svg('<g fill="#f86953"><rect x="5" y="8" width="17" height="14" rx="3"/><rect x="26" y="30" width="17" height="14" rx="3"/><rect x="7" y="53" width="17" height="14" rx="3"/></g><g fill="#ffbe63"><rect x="30" y="9" width="14" height="12" rx="3"/><rect x="3" y="32" width="14" height="12" rx="3"/><rect x="31" y="54" width="14" height="12" rx="3"/></g><path d="M50 15h23m-8-7 8 7-8 7M49 37h28m-8-7 8 7-8 7M51 60h22m-8-7 8 7-8 7" stroke="#ffe478" stroke-width="5"/>'),
  svg('<path d="m23 24-9-10m39 8 10-10M19 36H7m51-2 13-5M18 49 6 57m54-9 12 8M27 62l-4 9m26-10 7 9" stroke="#8053a7" stroke-width="5"/><path d="M23 25q16-18 32 0l8 19q0 21-23 22T17 44z" fill="#b47ade"/><path d="M40 30v29" stroke="#8c50b7"/><path d="m26 33 8 4m11 0 8-5" stroke="#193246" stroke-width="5"/><path d="m32 48 8 6 9-7" fill="#fff4d7"/><circle cx="22" cy="10" r="4" fill="#dfb6f3" stroke="none"/>'),
];
const defenseArt = [
  svg('<path d="m40 7 25 10v20c0 22-25 35-25 35S15 59 15 37V17z" fill="#7ed6e3"/><path d="m40 14 18 7v17c0 14-18 25-18 25" stroke="#d9fbff" stroke-width="4"/><rect x="29" y="34" width="23" height="20" rx="5" fill="#ffe282"/><path d="M33 34v-6a8 8 0 0 1 16 0v6"/><path d="M41 42v5"/>'),
  svg('<path d="M25 71V14h38v57" stroke="#193246" stroke-width="13"/><path d="M25 71V14h38v57" stroke="#7ed6e3" stroke-width="7"/><rect x="29" y="16" width="30" height="13" rx="3" fill="#c9e0ff"/><path d="M32 29v14m8-14v14m8-14v14m8-14v14" stroke="#508fd0" stroke-width="4"/><path d="M33 55h20m-6-6 6 6-6 6" stroke="#a1e6d0" stroke-width="4"/><path d="M18 72h14m24 0h14" stroke-width="5"/><circle cx="43" cy="22" r="3" fill="#a1e6d0" stroke="none"/>'),
  svg('<path d="m40 6 26 12v19c0 22-26 35-26 35S14 59 14 37V18z" fill="#92e0a8"/><rect x="20" y="26" width="41" height="24" rx="8" transform="rotate(-35 40 38)" fill="#fff0bd"/><path d="M36 29h9v9h9v9h-9v9h-9v-9h-9v-9h9z" fill="#40a37a" stroke="none"/><path d="m24 25-3 3m36 20-3 3" stroke="#d2b572"/>'),
];

attackArt.push(svg('<path d="m4 37 14-5L8 16l26 9L38 4l13 20 23-9-9 23 11 20-27-3-14 21-8-23L4 54z" fill="#ffc94f" stroke="#ad397b"/><path d="m46 12-23 31h17l-7 26 26-37H42z" fill="#f86d9c" stroke="#5f287c"/><path d="m26 38 7 3m13 0 9-6" stroke="#193246" stroke-width="4"/>'));
defenseArt.push(svg('<path d="m40 3 32 13v23c0 23-32 38-32 38S8 62 8 39V16z" fill="#69e4de" stroke="#217d9c"/><path d="m40 12 23 10v16c0 17-23 29-23 29S17 55 17 38V22z" fill="#e5ffff" stroke="#5aa7c7"/><path d="m27 38 9 10 18-22" stroke="#25968b" stroke-width="6"/><path d="M40 18v6m-18 9 5 2m26 0 5-2" stroke="#70d5ce"/>'));

export function effectMarkup(role: Role, strategy: CombatStrategy) {
  if (role === 'attack') return `<div class="battle-effect fx-attack-${strategy}"><span class="fx-trail"></span><span class="fx-projectile">${attackArt[strategy]}</span>${strategy === 1 ? `<span class="fx-projectile traffic-wave">${attackArt[1]}</span>` : ''}${sparkles}<span class="fx-impact">${svg(star)}</span></div>`;
  const decoration = strategy === 3 ? '<i class="ultimate-ring"></i><i class="ultimate-ring second"></i>' : strategy === 0 ? '<i class="shield-orbit"></i><i class="shield-orbit second"></i><span class="orbit-dot"></span>'
    : strategy === 1 ? '<i class="rebound-packet"></i><i class="rebound-packet second"></i><i class="through-packet"></i>'
      : `<span class="patch-confetti">${svg('<path d="M35 20h10v15h15v10H45v15H35V45H20V35h15z" fill="#61c99a" stroke="none"/>')}</span><span class="patch-confetti second">${svg(star)}</span><i class="repair-ring"></i>`;
  return `<div class="battle-effect fx-defense-${strategy}">${decoration}<span class="fx-guard">${defenseArt[strategy]}</span>${sparkles}</div>`;
}

export class BattleEffects {
  private timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private actors = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  private variant = 0;
  play(stage: HTMLElement | null, role: Role, strategy: CombatStrategy) {
    const lane = stage?.querySelector<HTMLElement>(`[data-effects="${role}"]`);
    if (!lane) return;
    // Let each projectile complete its flight while keeping rapid tapping bounded.
    if (lane.children.length >= 4) this.remove(lane.firstElementChild as HTMLElement);
    const template = lane.ownerDocument.createElement('template'); template.innerHTML = effectMarkup(role, strategy);
    const effect = template.content.firstElementChild as HTMLElement;
    effect.dataset.variant = String(this.variant++ % 3);
    effect.style.setProperty('--travel', `${(stage!.clientWidth || 300) * .5}px`);
    lane.append(effect);
    this.timers.set(effect, setTimeout(() => this.remove(effect), 680));
    const actor = stage!.querySelector<HTMLElement>(role === 'attack' ? '.attacker-art' : '.defender-art');
    if (actor) {
      clearTimeout(this.actors.get(actor)); actor.classList.remove('casting'); void actor.offsetWidth; actor.classList.add('casting');
      this.actors.set(actor, setTimeout(() => { actor.classList.remove('casting'); this.actors.delete(actor); }, 220));
    }
  }
  private remove(effect: HTMLElement) { clearTimeout(this.timers.get(effect)); effect.remove(); this.timers.delete(effect); }
  clear() {
    for (const effect of this.timers.keys()) this.remove(effect);
    for (const [actor, timer] of this.actors) { clearTimeout(timer); actor.classList.remove('casting'); }
    this.actors.clear();
  }
}
