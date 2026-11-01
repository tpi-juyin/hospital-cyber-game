import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { bindCombatInput } from '../src/client/combat-input';

test('held first finger does not block strategy, ultimate or secondary finger taps', async () => {
  const w = new Window();
  try {
    const actions: string[] = [];
    const buttons = ['tap', 'strategy', 'ultimate'].map(name => {
      const b = w.document.createElement('button');
      w.document.body.append(b);
      bindCombatInput(b as unknown as HTMLButtonElement, () => actions.push(name));
      return b;
    });
    const down = (index: number, id: number, primary: boolean) => buttons[index].dispatchEvent(new w.PointerEvent('pointerdown', { pointerId:id, pointerType:'touch', isPrimary:primary, button:0, cancelable:true }));
    down(0, 1, true); // Keep this finger down throughout.
    assert.equal(down(1, 2, false), false, 'prevent browser gesture handling');
    down(2, 3, false);
    down(0, 4, false);
    assert.deepEqual(actions, ['tap', 'strategy', 'ultimate', 'tap']);
    buttons[0].dispatchEvent(new w.PointerEvent('pointerup', { pointerId:1 }));
    buttons[0].dispatchEvent(new w.MouseEvent('click', { detail:1 }));
    buttons[0].dispatchEvent(new w.PointerEvent('click', { detail:0, pointerType:'touch' }));
    buttons[1].dispatchEvent(new w.PointerEvent('pointercancel', { pointerId:2 }));
    assert.equal(actions.length, 4, 'release, cancellation and compatibility clicks never repeat actions');
    buttons[1].disabled = true; down(1, 5, false); buttons[1].click();
    buttons[0].dispatchEvent(new w.PointerEvent('pointerdown', { button:2, pointerType:'mouse' }));
    assert.equal(actions.length, 4, 'disabled and secondary mouse buttons do nothing');
    buttons[0].click();
    assert.equal(actions.length, 5, 'keyboard/assistive activation still works');
  } finally { await w.happyDOM.close(); }
});
