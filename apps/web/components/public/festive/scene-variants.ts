/**
 * THE SCENE OPTIONS — pure data, no React, so site-variants.ts (which the API
 * side and the tests import) can validate a saved `variant` against it
 * without dragging the drawings in. scenes.tsx maps the same keys to the
 * renderers; a guard test keeps the two in step.
 *
 * `variants[0]` is the default and where a row written before scenes existed
 * (variant = an old emoji set such as 'DIYAS') falls to.
 */
export interface SceneVariant {
  value: string;
  label: string;
  hint: string;
  /** Shows a picture in a frame — the shipped public-domain painting, or the school's own upload. */
  picture?: boolean;
}

export const SCENE_VARIANTS: Record<string, SceneVariant[]> = {
  DIWALI: [
    { value: 'DEEPAVALI', label: 'Rangoli & diyas', hint: 'A flower rangoli with lamps set on it, a toran above, soft lights.' },
    { value: 'LAKSHMI', label: 'Lakshmi ji', hint: 'A framed Gaja-Lakshmi painting with a garland and lamps. Or your own picture.', picture: true },
    { value: 'LANTERNS', label: 'Kandils & lights', hint: 'Paper star lanterns swinging under a string of lights.' },
    { value: 'RANGOLI', label: 'Samai & rangoli', hint: 'A brass five-wick lamp beside a large rangoli.' },
  ],
  HOLI: [
    { value: 'SPLASH', label: 'Pichkari', hint: 'Water guns firing colour across the corner, splashes behind.' },
    { value: 'GULAL', label: 'Colour splashes', hint: 'Big soft gulal splashes in the margins.' },
    { value: 'BALLOONS', label: 'Water balloons', hint: 'Balloons of colour falling.' },
  ],
  EID: [
    { value: 'CHAAND', label: 'The moon', hint: 'A glowing crescent and a sky of stars.' },
    { value: 'LANTERNS', label: 'Fanoos lanterns', hint: 'Lanterns swinging under the crescent.' },
    { value: 'SKYLINE', label: 'Skyline', hint: 'Domes and minarets against the night, moon above.' },
  ],
  NAVRATRI: [
    { value: 'DANDIYA', label: 'Dandiya', hint: 'A pair of dandiya sticks clashing under a marigold toran.' },
    { value: 'GARBA', label: 'Garba', hint: 'The lit garbo pot, dandiya beside it.' },
    { value: 'DUSSEHRA', label: 'Ravan dahan', hint: 'The effigy in flames and Rama’s bow — for Dussehra day.' },
    { value: 'DURGA', label: 'Durga Ma', hint: 'A framed Ravi Varma painting of the Goddess. Or your own picture.', picture: true },
  ],
  GANESH: [
    { value: 'MURTI', label: 'Ganesh ji', hint: 'A framed Ravi Varma Press painting of Shri Ganesha, garlanded, with modaks. Or your own murti photo.', picture: true },
    { value: 'MODAK', label: 'Modaks & hibiscus', hint: 'A plate of modaks and falling hibiscus.' },
    { value: 'PETALS', label: 'Hibiscus', hint: 'Red hibiscus drifting under a toran.' },
  ],
  JANMASHTAMI: [
    { value: 'MATKI', label: 'Dahi handi', hint: 'The matki swinging on its rope, a peacock feather beside it.' },
    { value: 'KRISHNA', label: 'Krishna', hint: 'A framed Venugopal painting — flute and mor-pankh. Or your own picture.', picture: true },
    { value: 'FEATHER', label: 'Mor pankh', hint: 'Peacock feathers swaying.' },
  ],
  ONAM: [
    { value: 'POOKALAM', label: 'Pookalam', hint: 'The flower carpet blooming ring by ring, a kasavu border.' },
    { value: 'BOAT', label: 'Snake boat', hint: 'A chundan vallam gliding across the top.' },
    { value: 'PETALS', label: 'Petals', hint: 'Pookalam flowers drifting down.' },
  ],
  SANKRANTI: [
    { value: 'KITES', label: 'Kites', hint: 'Kites drifting across the sky.' },
    { value: 'SUN', label: 'Sun & kites', hint: 'The morning sun with kites.' },
    { value: 'PONGAL', label: 'Pongal pot', hint: 'The pot boiling over on its fire.' },
  ],
  RAKSHA: [
    { value: 'RAKHI', label: 'Rakhi', hint: 'A rakhi on its thread, turning slowly.' },
    { value: 'MITHAI', label: 'Mithai', hint: 'Sweets drifting down.' },
  ],
  INDEPENDENCE: [
    { value: 'BUNTING', label: 'Bunting & chakra', hint: 'Tricolour bunting, an Ashoka Chakra watermark.' },
    { value: 'FLAG', label: 'The flag', hint: 'The tiranga waving on its pole.' },
    { value: 'KITES', label: 'Kites', hint: 'Bunting with kites.' },
    { value: 'TRICOLOR', label: 'Tricolour drift', hint: 'Saffron, white and green drifting down.' },
  ],
  REPUBLIC: [
    { value: 'BUNTING', label: 'Bunting & chakra', hint: 'Tricolour bunting, an Ashoka Chakra watermark.' },
    { value: 'FLAG', label: 'The flag', hint: 'The tiranga waving on its pole.' },
    { value: 'TRICOLOR', label: 'Tricolour drift', hint: 'Saffron, white and green drifting down.' },
  ],
  CHILDRENS: [
    { value: 'BALLOONS', label: 'Balloons', hint: 'Balloons rising up the page.' },
    { value: 'DOODLES', label: 'Stars', hint: 'Bright stars drifting down.' },
    { value: 'CRAYONS', label: 'Crayons', hint: 'Crayons drifting down.' },
  ],
  TEACHERS: [
    { value: 'BOARD', label: 'The blackboard', hint: 'Chalk lines drawing themselves.' },
    { value: 'BOOKS', label: 'Books', hint: 'Open books drifting down.' },
    { value: 'GOLDDUST', label: 'Sparkle', hint: 'A quiet drift of gold.' },
  ],
  CHRISTMAS: [
    { value: 'TREE', label: 'The tree', hint: 'A lit tree with its star and gifts, snow falling.' },
    { value: 'LIGHTS', label: 'Fairy lights & snow', hint: 'A string of lights, snow falling.' },
    { value: 'GIFTS', label: 'Gifts', hint: 'Wrapped gifts and snow drifting down.' },
  ],
  NEWYEAR: [
    { value: 'FIREWORKS', label: 'Fireworks', hint: 'Slow bursts over a starry sky.' },
    { value: 'SPARKLE', label: 'Sparkle', hint: 'Gold sparkle drifting down.' },
  ],
  DURGA: [
    { value: 'DURGA', label: 'Durga Ma', hint: 'A framed Ravi Varma painting of the Goddess. Or your own picture.', picture: true },
    { value: 'DHAK', label: 'Dhak', hint: 'The dhak drum under a toran, shiuli petals falling.' },
    { value: 'PETALS', label: 'Shiuli', hint: 'White shiuli petals and lamps.' },
  ],
  VASANT: [
    { value: 'SARASWATI', label: 'Saraswati ji', hint: 'A framed Ravi Varma painting, yellow petals. Or your own picture.', picture: true },
    { value: 'PETALS', label: 'Mustard petals', hint: 'Yellow petals drifting down.' },
    { value: 'KITES', label: 'Kites', hint: 'Kites across a spring sky.' },
  ],
  UGADI: [
    { value: 'GUDI', label: 'The gudi', hint: 'A gudi raised on its pole under a mango-leaf toran.' },
    { value: 'RANGOLI', label: 'Rangoli', hint: 'A rangoli under the toran.' },
    { value: 'PETALS', label: 'Neem & mango', hint: 'Leaves drifting under the toran.' },
  ],
  BAISAKHI: [
    { value: 'WHEAT', label: 'Wheat', hint: 'Sheaves of wheat swaying.' },
    { value: 'SUN', label: 'Harvest sun', hint: 'The sun over the wheat.' },
    { value: 'KITES', label: 'Kites', hint: 'Kites across the sky.' },
  ],
  GURUNANAK: [
    { value: 'DIYAS', label: 'Lamps', hint: 'A row of lit lamps, warm light.' },
    { value: 'LIGHTS', label: 'Lights', hint: 'A string of lights, warm light.' },
  ],
  LOHRI: [
    { value: 'BONFIRE', label: 'Bonfire', hint: 'The Lohri fire with sparks rising.' },
    { value: 'KITES', label: 'Kites', hint: 'Kites across the sky.' },
  ],
  GANDHI: [
    { value: 'CHARKHA', label: 'Charkha', hint: 'The spinning wheel, turning.' },
    { value: 'DOVE', label: 'Doves', hint: 'White doves drifting.' },
  ],
};

export const sceneVariants = (festival: string): SceneVariant[] => SCENE_VARIANTS[festival] ?? [];
