import type { FestivalKey } from '../site-variants';
import type { Scene } from './scene-types';
import { ChristmasScene, DiwaliScene, EidScene, GuruNanakScene, JanmashtamiScene, LohriScene, NewYearScene } from './scenes-lights';
import { BaisakhiScene, DurgaScene, GaneshScene, HoliScene, NavratriScene, OnamScene, RakshaScene, SankrantiScene, UgadiScene, VasantScene } from './scenes-colour';
import { ChildrensScene, GandhiScene, TeachersScene, TirangaScene } from './scenes-nation';

/**
 * ONE SCENE PER FESTIVAL, EACH WITH ITS OWN OBJECTS.
 *
 * The first treatments shared a single composition and recoloured it; every
 * festival looked like the same banner. This is the opposite: each festival
 * draws the things that ARE that festival — diyas and a rangoli, a pichkari,
 * the crescent, dandiya and Ravan dahan, a matki and a mor-pankh, the tree
 * and its star — and offers three or four ways to show them. Deities are
 * public-domain classical paintings in a frame (see /festive/art/CREDITS.md),
 * and a school can put its own picture in that frame from the Studio.
 *
 * The options each scene offers live in scene-variants.ts (pure data); this
 * file only maps a festival to the component that draws it.
 */
export const SCENES: Record<FestivalKey, Scene> = {
  DIWALI: DiwaliScene,
  HOLI: HoliScene,
  EID: EidScene,
  NAVRATRI: NavratriScene,
  GANESH: GaneshScene,
  JANMASHTAMI: JanmashtamiScene,
  ONAM: OnamScene,
  SANKRANTI: SankrantiScene,
  RAKSHA: RakshaScene,
  INDEPENDENCE: TirangaScene,
  REPUBLIC: TirangaScene,
  CHILDRENS: ChildrensScene,
  TEACHERS: TeachersScene,
  CHRISTMAS: ChristmasScene,
  NEWYEAR: NewYearScene,
  DURGA: DurgaScene,
  VASANT: VasantScene,
  UGADI: UgadiScene,
  BAISAKHI: BaisakhiScene,
  GURUNANAK: GuruNanakScene,
  LOHRI: LohriScene,
  GANDHI: GandhiScene,
};
