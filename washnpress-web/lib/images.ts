// Real lifestyle photography, verified for subject before use: laundry, car care and
// gated-community living. Each entry is an Unsplash photo id plus honest alt text, so
// every image on the site is a real image with a real description behind it.
function url(id: string, w = 1200, q = 70) {
  return `https://images.unsplash.com/photo-${id}?w=${w}&q=${q}&auto=format&fit=crop`;
}

export interface Img {
  src: string;
  alt: string;
}

const img = (id: string, alt: string, w?: number): Img => ({ src: url(id, w), alt });

export const images = {
  // Hero — floating cards.
  heroDrum: img("1610557892470-55d9e80c0bce", "Freshly laundered clothes tumbling in a washing machine", 900),
  heroCar: img("1607860108855-64acf2078ed9", "A car being washed by hand under thick white foam", 900),
  heroHome: img("1512917774080-9991f1c4c750", "A modern gated-community home with palm trees", 900),
  // Services.
  laundry: img("1545173168-9f1947eebb7f", "A row of front-loading washing machines in a clean laundry", 800),
  ironing: img("1582735689369-4fe89db7114c", "A basket of neatly folded and pressed laundry", 800),
  carCare: img("1520340356584-f9917d1eea6f", "The rear of a car being rinsed with foam at a wash", 800),
  subscription: img("1560448204-e02f11c3d0e2", "A bright, tidy modern living room", 800),
  // Bands and backgrounds.
  community: img("1600585154340-be6161a56a0c", "A contemporary gated-community residence at dusk", 1400),
  carDetail: img("1552930294-6b595f4c2974", "A person carefully washing a dark car", 1000),
} as const;
