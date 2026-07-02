import type { Card, CardMeta } from './Card.js';
import { StoneMonkey } from './defs/StoneMonkey.js';
import { FoolishOldMan } from './defs/FoolishOldMan.js';
import { MonkeyKing } from './defs/MonkeyKing.js';
import { Avenger } from './defs/Avenger.js';
import { Traitor } from './defs/Traitor.js';
import { Revolution } from './defs/Revolution.js';
import { Slime } from './defs/Slime.js';
import { KingSlime } from './defs/KingSlime.js';
import { Hero } from './defs/Hero.js';
import { AdventureStart } from './defs/AdventureStart.js';
import { QuestSlime } from './defs/QuestSlime.js';
import { HealthPotion } from './defs/HealthPotion.js';
import { Warrior } from './defs/Warrior.js';
import { Priest } from './defs/Priest.js';
import { Mage } from './defs/Mage.js';
import { Bomb } from './defs/Bomb.js';
import { Church } from './defs/Church.js';
import { FullPlateArmor } from './defs/FullPlateArmor.js';
import { HolySword } from './defs/HolySword.js';
import { Guard } from './defs/Guard.js';
import { Inn } from './defs/Inn.js';
import { GoddessHelp } from './defs/GoddessHelp.js';
import { FateAwakening } from './defs/FateAwakening.js';
import { Goblin } from './defs/Goblin.js';
import { QuestLabyrinth } from './defs/QuestLabyrinth.js';
import { SkeletonSoldier } from './defs/SkeletonSoldier.js';
import { Skeleton } from './defs/Skeleton.js';
import { HeadlessKnight } from './defs/HeadlessKnight.js';
import { HeadlessKnightHead } from './defs/HeadlessKnightHead.js';
import { DemonCastle } from './defs/DemonCastle.js';
import { DemonLord } from './defs/DemonLord.js';
import { RevivalRitual } from './defs/RevivalRitual.js';
import { SonWukong } from './defs/SonWukong.js';
import { Pilmaon } from './defs/Pilmaon.js';
import { JeCheonDaeSung } from './defs/JeCheonDaeSung.js';
import { SonHaengja } from './defs/SonHaengja.js';
import { TuJeonSeungBul } from './defs/TuJeonSeungBul.js';
import { SuboriJosa } from './defs/SuboriJosa.js';
import { TangMonk } from './defs/TangMonk.js';
import { JeonDanGongDeokBul } from './defs/JeonDanGongDeokBul.js';
import { JeOneung } from './defs/JeOneung.js';
import { JeongDanSaja } from './defs/JeongDanSaja.js';
import { SaOJeong } from './defs/SaOJeong.js';
import { GeumshinNahan } from './defs/GeumshinNahan.js';
import { Trap } from './defs/Trap.js';
import { Castling } from './defs/Castling.js';
import { GreatFire } from './defs/GreatFire.js';
import { OldFriend } from './defs/OldFriend.js';
import { EndOfDays } from './defs/EndOfDays.js';
import { GTeacher } from './defs/GTeacher.js';
import { CultRitual } from './defs/CultRitual.js';
import { FirstRitual, SecondRitual, ThirdRitual, LastRitual } from './defs/SacredRituals.js';
import { WickedGod } from './defs/WickedGod.js';
import { Cultist } from './defs/Cultist.js';
import { DarkArtsDream } from './defs/DarkArtsDream.js';

const ALL_CARDS: Card[] = [
  StoneMonkey,
  FoolishOldMan,
  MonkeyKing,
  Avenger,
  Traitor,
  Revolution,
  // 영웅담 테마
  Slime,
  KingSlime,
  Hero,
  AdventureStart,
  QuestSlime,
  HealthPotion,
  Warrior,
  Priest,
  Mage,
  Bomb,
  Church,
  FullPlateArmor,
  HolySword,
  Inn,
  GoddessHelp,
  // 영웅담 적 퀘스트 체인
  FateAwakening,
  Goblin,
  QuestLabyrinth,
  SkeletonSoldier,
  Skeleton,
  HeadlessKnight,
  HeadlessKnightHead,
  DemonCastle,
  DemonLord,
  RevivalRitual,
  // 서유기 테마
  SonWukong,
  Pilmaon,
  JeCheonDaeSung,
  SonHaengja,
  TuJeonSeungBul,
  SuboriJosa,
  TangMonk,
  JeonDanGongDeokBul,
  JeOneung,
  JeongDanSaja,
  SaOJeong,
  GeumshinNahan,
  Guard,
  // 테마:없음 신규
  Trap,
  Castling,
  GreatFire,
  OldFriend,
  EndOfDays,
  GTeacher,
  // 사교도 테마
  CultRitual,
  FirstRitual,
  SecondRitual,
  ThirdRitual,
  LastRitual,
  WickedGod,
  Cultist,
  DarkArtsDream,
];

export class CardRegistry {
  private readonly map: Map<string, Card>;

  constructor(cards: Card[]) {
    this.map = new Map(cards.map((c) => [c.id, c]));
  }

  get(cardId: string): Card {
    const c = this.map.get(cardId);
    if (!c) throw new Error(`Unknown card: ${cardId}`);
    return c;
  }

  has(cardId: string): boolean {
    return this.map.has(cardId);
  }

  getDef(cardId: string): CardMeta {
    return this.get(cardId).meta;
  }

  all(): Card[] {
    return [...this.map.values()];
  }
}

export const CARD_REGISTRY = new CardRegistry(ALL_CARDS);

export function getCard(cardId: string): Card {
  return CARD_REGISTRY.get(cardId);
}

export function getDef(cardId: string): CardMeta {
  return CARD_REGISTRY.getDef(cardId);
}

export function findCardByName(name: string): CardMeta | undefined {
  return CARD_REGISTRY.all().find((c) => c.name === name)?.meta;
}
