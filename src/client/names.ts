const adjectives = ['閃電', '暗夜', '疾風', '星際', '機智', '神速', '神秘', '烈焰', '霓虹', '量子', '月光', '鋼鐵'];
const characters = ['狐狸', '貓頭鷹', '獵豹', '飛鷹', '水獺', '黑貓', '雪狼', '熊貓', '海豚', '松鼠', '白虎', '游隼'];

/** A different suggestion on every roll, including when the random source repeats. */
export function randomName(previous = '', random = Math.random): string {
  const count = adjectives.length * characters.length;
  let index = Math.floor(random() * count);
  const nameAt = (n: number) => adjectives[Math.floor(n / characters.length)] + characters[n % characters.length];
  if (nameAt(index) === previous) index = (index + 1) % count;
  return nameAt(index);
}
