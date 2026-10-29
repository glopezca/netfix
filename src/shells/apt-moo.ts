/**
 * `apt moo`: APT's super cow, as apt prints it (copied from apt's own output): one, two or three moos draw different
 * cows, the phrase changes on a few dates, and on 1 April every moo is the smashed-milk cow. The cow moves right as
 * the phrase grows.
 */

/** Month (0-11), day, phrase and how far apt moves the three-moo cow for it. */
const PHRASES: readonly (readonly [month: number, day: number, phrase: string, shift3: number])[] = [
  [11, 25, 'Happy package management day!', 4],
  [7, 16, 'Three moos for Debian!', 3],
  [10, 7, 'Whoever needs milk, bows to the animal.', 5],
  [1, 18, "It's a Bird ... It's a Plane ... It's Super Cow!", 5],
];
const NORMAL = ['Have you mooed today?', 3] as const;

const APRIL = [
  '               _     _',
  '              (_\\___( \\,',
  '                )___   _  Have you smashed some milk today?',
  "               /( (_)-(_)    /",
  "    ,---------'         \\_",
  "  //(  ',__,'      \\  (' ')",
  " //  )              '----'",
  " '' ; \\     .--.  ,/",
  "    | )',_,'----( ;",
  "    ||| '''     '||",
];

const COW1 = ['          (__) ', '          (oo) ', '    /------\\/ ', '   / |    ||   ', '  *  /\\---/\\ ', '     ~~   ~~   '];
const COW2 = ['          (__)  ', '  _______~(..)~ ', '    ,----\\(oo) ', "   /|____|,'    ", '  * /"\\ /\\   ', '    ~ ~ ~ ~     '];
const COW3 = ['                  \\_/ ', 'm00h  (__)       -(_)- ', '   \\  ~Oo~___     / \\', '      (..)  |\\        '];

function phraseOf(ms: number): readonly [string, number] {
  const d = new Date(ms);
  const special = PHRASES.find(([m, day]) => d.getUTCMonth() === m && d.getUTCDate() === day);
  return special ? [special[2], special[3]] : NORMAL;
}

/** Lines of `apt moo …` with `moos` moos, on the date of `ms` (the simulated clock, UTC). */
export function mooLines(moos: number, ms: number): string[] {
  const d = new Date(ms);
  if (d.getUTCMonth() === 3 && d.getUTCDate() === 1) return [...APRIL];
  const [phrase, shift3] = phraseOf(ms);
  const line = `..."${phrase}"...`;
  const pad = (n: number): string => ' '.repeat(n);
  if (moos === 3) {
    const left = 8 + shift3;
    return [...COW3.map((l) => pad(shift3) + l), `${'_'.repeat(left)}|_|_|${'_'.repeat(line.length - left - 5)}`, line];
  }
  const depth = Math.floor((phrase.length + 9) / 4);
  return [...(moos === 2 ? COW2 : COW1).map((l) => pad(depth) + l), line];
}
