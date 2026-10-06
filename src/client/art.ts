export function icon(name: string, size = 24) {
  const paths: Record<string, string> = {
    key: '<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-4-4 3-3m-6 0 3-3"/>',
    bolt: '<path d="m14 2-10 12h7l-1 8L21 9h-8z"/>',
    bug: '<rect x="7" y="7" width="10" height="14" rx="5"/><path d="m9 7-2-4m8 4 2-4M3 11h4m10 0h4M3 17h4m10 0h4M12 9v12"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z"/><path d="m8 12 3 3 5-6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-4a7 7 0 0 1 14 0v4m0-17a3 3 0 0 1 0 6m3 4a5 5 0 0 1 3 4v3"/>',
    cpu: '<rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4M19 9h4m-4 6h4"/><rect x="9" y="9" width="6" height="6"/>',
    sound: '<path d="M3 9h4l5-5v16l-5-5H3zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16"/>',
    mute: '<path d="M3 9h4l5-5v16l-5-5H3zm13 0 6 6m0-6-6 6"/>',
    heart: '<path d="M12 21 3 12C-3 4 7-2 12 5c5-7 15-1 9 7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    dice: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01" stroke-width="3"/>',
    music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    filter: '<path d="M3 4h18l-7 8v7l-4 2v-9zM2 9h4m12 0h4"/>',
    patch: '<path d="m8 2 8 0 6 6v8l-6 6H8l-6-6V8zM12 7v10M7 12h10"/>',
    trophy: '<path d="M7 3h10v7a5 5 0 0 1-10 0zM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 3v6m-4 0h8"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.shield}</svg>`;
}
export function hacker(outcome: 'neutral' | 'win' | 'loss' = 'neutral') { return `<svg class="character hacker" data-outcome="${outcome}" viewBox="0 0 180 180" aria-hidden="true">
<ellipse cx="91" cy="165" rx="66" ry="9" fill="#182f4330"/>
<path d="m36 128 5-58-4-39 27 12L91 15l26 27 28-14-4 43 5 58-19 24H53z" fill="#a978d0" stroke="#193246" stroke-width="5" stroke-linejoin="round"/>
<path d="m48 47 14 9 29-29 27 29 16-10-8 50H53z" fill="#d5a4f1"/>
<path d="M54 84c2-28 18-43 37-47 24 7 38 25 37 49l-15 21H70z" fill="#243446" stroke="#193246" stroke-width="4"/>
${outcome === 'loss' ? '<path d="m64 67 15 14m0-14-15 14m38-14 15 14m0-14-15 14" stroke="#ffafaf" stroke-width="4"/><path d="M76 101q15-14 29-2" fill="none" stroke="#ffdec2" stroke-width="4"/><path d="m128 80 6 10q-7 8-10 0z" fill="#79dfff"/>' : '<path d="m62 67 23 10-18 5zm58 0-23 10 18 5z" fill="#ff614e"/><path d="m67 72 13 5m34-5-13 5" stroke="#ffc583" stroke-width="2" stroke-linecap="round"/><path d="M73 90q19 16 37-3l-7 15-21 1z" fill="#fff3c7"/><path d="m84 94 1 7m12-7-1 8" stroke="#193246" stroke-width="2"/>'}
<path d="m50 108-23 33m102-35 24 34" stroke="#193246" stroke-width="20" stroke-linecap="round"/><path d="m50 108-23 33m102-35 24 34" stroke="#bb8de0" stroke-width="11" stroke-linecap="round"/>
<path d="m49 99 23 9 19 15 18-15 24-11-9 59H58z" fill="#a978d0" stroke="#193246" stroke-width="4"/>
<rect x="39" y="115" width="104" height="47" rx="7" fill="#4c7894" stroke="#193246" stroke-width="5"/>
<path d="M47 121h86" stroke="#a6d9ed" stroke-width="3" stroke-linecap="round"/><path d="m50 125 5 5-5 5m7 2h10" fill="none" stroke="#d4ff80" stroke-width="3" stroke-linecap="round"/>
<path d="M86 134a10 10 0 1 1 19 4v8H88v-8z" fill="#d4ff80"/>
<path d="m90 136 4 2m7-2-4 2m-3 7v4m4-4v4" stroke="#193246" stroke-width="3"/>
<path d="M32 163h118" stroke="#193246" stroke-width="7" stroke-linecap="round"/>
${outcome === 'win' ? '<path d="m68 22-4-18 16 10L91 1l11 13 17-10-5 18z" fill="#ffdc6d" stroke="#193246" stroke-width="3"/><path d="m18 60 4 9 10 2-8 7 1 10-8-5-9 5 2-10-7-7 10-2zm140-21 3 7 8 1-6 6 2 8-7-4-7 4 1-8-5-6 8-1z" fill="#ffe477"/>' : outcome === 'loss' ? '<path d="m27 40-8-12m137 28 7-12m-4 42 10 2" stroke="#98b4d7" stroke-width="4" stroke-linecap="round"/>' : '<path d="m18 76 8-8-2 13 8-7m119-16 9-9-2 14 8-8" fill="none" stroke="#b06bac" stroke-width="4" stroke-linejoin="round"/>'}
</svg>`; }
const failedMachines = (hp: number) => hp <= 0 ? 2 : hp <= 50 ? 1 : 0;
function serverMachine(x: number, y: number, down: boolean, primary: boolean) {
  const face = down
    ? '<path d="m14 19 7 7m0-7-7 7m19-7 7 7m0-7-7 7" stroke="#fb8d7d" stroke-width="3"/><path d="M23 32h7" stroke="#fb8d7d" stroke-width="2"/>'
    : '<path d="M17 21v4m20-4v4" stroke="#a0efd0" stroke-width="4"/><path d="M23 30q4 4 8 0" fill="none" stroke="#a0efd0" stroke-width="2"/>';
  return `<g class="server-machine ${down ? 'is-down' : 'is-up'}" data-machine="${primary ? 'primary' : 'backup'}" transform="translate(${x} ${y})${down ? ' rotate(-7 27 73)' : ''}">
  ${down ? '<path d="M13-5q-7-7 1-13t-2-13m22 28q7-8 0-15t4-13" fill="none" stroke="#8b969e" stroke-width="4" stroke-linecap="round" opacity=".75"/>' : ''}
  <rect x="0" y="0" width="54" height="75" rx="8" fill="${down ? '#8e999e' : primary ? '#75c6d9' : '#94d7bf'}" stroke="#193246" stroke-width="4"/>
  <path d="M7 6h37" stroke="${down ? '#aeb5b7' : '#d8f5ed'}" stroke-width="3" stroke-linecap="round"/>
  <rect x="7" y="12" width="40" height="25" rx="5" fill="${down ? '#34414b' : '#233c52'}"/>
  ${face}
  <rect x="8" y="44" width="38" height="9" rx="3" fill="${down ? '#677880' : '#e7f8ed'}"/>
  <rect x="8" y="58" width="38" height="9" rx="3" fill="${down ? '#677880' : '#e7f8ed'}"/>
  <circle cx="39" cy="48.5" r="2.4" fill="${down ? '#f77e6e' : '#37a779'}"/><circle cx="39" cy="62.5" r="2.4" fill="${down ? '#f77e6e' : '#37a779'}"/>
  <path d="M13 49h16m-16 14h16" stroke="${down ? '#475d68' : '#5b9187'}" stroke-width="2" stroke-linecap="round"/>
  ${down ? '<path d="m25 39-6 8 8 7-5 15" fill="none" stroke="#c8574c" stroke-width="2.5"/>' : ''}
  <path d="M8 76h8m22 0h8" stroke="#193246" stroke-width="5" stroke-linecap="round"/>
  </g>`;
}
export function hospital(hp = 100) {
  const down = failedMachines(hp), dead = down === 2;
  return `<svg class="character hospital" data-down-count="${down}" viewBox="0 0 180 180" aria-hidden="true">
  <ellipse cx="91" cy="166" rx="77" ry="9" fill="#182f4320"/>
  <path d="M25 67h130v89H25z" fill="${dead ? '#c0c9c6' : '#bde4d0'}" stroke="#193246" stroke-width="4"/>
  <rect x="53" y="25" width="74" height="129" rx="10" fill="${dead ? '#d0d3ca' : '#fffdf4'}" stroke="#193246" stroke-width="4"/>
  <path d="M85 37h11v12h12v11H96v12H85V60H73V49h12z" fill="${dead ? '#9a8580' : '#f37e68'}"/>
  <path d="M34 77h9m-9 15h9m94-15h9m-9 15h9" stroke="${dead ? '#78898a' : '#fffdf4'}" stroke-width="5" stroke-linecap="round"/>
  <path d="M54 158v5h73v-5" fill="none" stroke="${dead ? '#929995' : '#71b698'}" stroke-width="4"/>
  ${serverMachine(25, 80, down >= 1, true)}${serverMachine(101, 86, dead, false)}
  <path d="m137 25 15 6v13c0 10-15 17-15 17s-15-7-15-17V31z" fill="${dead ? '#8e999e' : '#70c4ea'}" stroke="#193246" stroke-width="3"/>
  ${dead ? '<path d="m131 36 12 12m0-12-12 12" stroke="#f9b1a0" stroke-width="3"/>' : '<path d="m130 42 5 5 9-11" fill="none" stroke="#fff" stroke-width="3"/>'}
  </svg>`;
}
export function updateHospital(root: ParentNode, hp: number) {
  const count = String(failedMachines(hp));
  root.querySelectorAll<SVGElement>('svg.hospital').forEach(svg => {
    if (svg.dataset.downCount !== count) svg.outerHTML = hospital(hp);
  });
}
export function arena(hp = 100) { return `<div class="arena"><div class="arena-lines"></div><div class="fighter attacker-art">${hacker()}<span>ATTACK</span></div><div class="versus"><span>VS</span><i></i></div><div class="fighter defender-art">${hospital(hp)}<span>DEFEND</span></div><div class="impact" aria-hidden="true">✦</div></div>`; }
export const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
