// Static reference content for the "Explore Styles" page. This is general
// reference information (like a lookup table), not a personalized AI result,
// so it is fine for it to be hand-authored rather than generated per-request.

const HAIR_STYLES = [
  { name: 'Taper', description: 'Hair gradually shortens down the sides and back while keeping length on top. Clean and versatile.', suitableFaceShapes: ['Oval', 'Square', 'Diamond'], maintenance: 'Medium' },
  { name: 'Fade', description: 'A sharper, more dramatic version of the taper that blends to skin near the hairline.', suitableFaceShapes: ['Oval', 'Round', 'Square'], maintenance: 'Medium' },
  { name: 'Textured Crop', description: 'Short, choppy layers on top with a natural, matte finish. Low-fuss styling.', suitableFaceShapes: ['Round', 'Square', 'Heart'], maintenance: 'Low' },
  { name: 'Fringe', description: 'Hair swept forward over the forehead, softening a longer or more angular face.', suitableFaceShapes: ['Oblong', 'Square'], maintenance: 'Medium' },
  { name: 'Curtains', description: 'Center-parted hair that falls to either side, framing the face symmetrically.', suitableFaceShapes: ['Oval', 'Heart', 'Diamond'], maintenance: 'Medium' },
  { name: 'Side Part', description: 'A classic, defined part with hair combed to one side. Polished and professional.', suitableFaceShapes: ['Oval', 'Round', 'Diamond'], maintenance: 'Medium' },
  { name: 'Quiff', description: 'Hair swept upward and back from the forehead for added height and volume.', suitableFaceShapes: ['Round', 'Oblong'], maintenance: 'High' },
  { name: 'Crew Cut', description: 'Short all over with slightly more length on top. Easy to maintain, always neat.', suitableFaceShapes: ['Oval', 'Square', 'Round'], maintenance: 'Low' },
  { name: 'Buzz Cut', description: 'Very short, uniform length all over using clippers. Minimal styling required.', suitableFaceShapes: ['Oval', 'Square', 'Diamond'], maintenance: 'Low' },
];

const BEARD_STYLES = [
  { name: 'Clean Shave', description: 'No facial hair. Emphasizes jawline and skin, and reads as polished and low-maintenance.', suitableFaceShapes: ['Oval', 'Round', 'Square', 'Heart', 'Diamond', 'Oblong'], maintenance: 'Low' },
  { name: 'Stubble', description: 'Short, even growth (1-3mm) for a rugged but tidy look with minimal upkeep.', suitableFaceShapes: ['Oval', 'Square', 'Diamond'], maintenance: 'Low' },
  { name: 'Boxed Beard', description: 'A neatly defined beard with crisp edges along the cheeks and neckline.', suitableFaceShapes: ['Round', 'Heart', 'Oblong'], maintenance: 'Medium' },
  { name: 'Goatee', description: 'Hair on the chin and mustache, with the cheeks kept clean. Adds definition to a rounder jaw.', suitableFaceShapes: ['Round', 'Oval'], maintenance: 'Medium' },
  { name: 'Full Beard', description: 'Fuller growth covering the jaw and cheeks, softened at the edges. Adds visual width and length.', suitableFaceShapes: ['Oblong', 'Diamond', 'Heart'], maintenance: 'High' },
];

function getStyleLibrary() {
  return { hair: HAIR_STYLES, beard: BEARD_STYLES };
}

module.exports = { getStyleLibrary };
