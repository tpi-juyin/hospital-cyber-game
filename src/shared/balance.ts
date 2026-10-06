export const BALANCE = {
  attackDamage: 1.15,
  shieldRestore: .7,
  matchedAbsorption: 1.25,
  mismatchedAbsorption: .25,
  strategyCooldownMs: 3000,
} as const;

export const ULTIMATE = {
  durationMs: 5000,
  maxUses: 2,
  chargePerTap: 1.25, // 80 accepted taps in a 60-second round; no passive charge.
  attackMultiplier: 1.5,
  defenseDamageReduction: .75,
  defenseShieldMultiplier: 1.5,
  botReactionMs: 650,
} as const;
