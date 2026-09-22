// Every photograph on the UMORA public site is referenced from here, so the
// imagery can be replaced without touching layout code.
//
// All files in /public/umora/photos/ are licensed stock photographs. Source,
// photographer, licence and the release caveats for each one are recorded in
// docs/marketing/UMORA-MEDIA-LICENSES.md — update that record whenever an
// image here changes. The people shown are illustrative and are not
// presented as customers.

export type UmoraImage = {
  src: string;
  alt: string;
  /** Minimum pixel size for the production asset. */
  final: string;
  /** What the photograph must show. */
  brief: string;
  /** CSS object-position focus point for this photograph's crop. */
  position?: string;
};

const photo = (name: string) => `/umora/photos/${name}.jpg`;

export const heroPerson: UmoraImage = {
  src: photo("hero-person"),
  alt: "Smiling café team member in a dark apron",
  final: "1200 × 1600 (portrait), dark café background",
  brief: "Front-of-house worker, warm smile, dark apron, dark warm café interior with bokeh.",
  position: "34% 18%",
};

export const workforcePortraits: (UmoraImage & { label: string })[] = [
  {
    label: "Retail",
    src: photo("portrait-retail"),
    alt: "Shop team member in a leather apron",
    final: "600 × 800",
    brief: "Retail associate in apron, store interior.",
    position: "50% 30%",
  },
  {
    label: "Hospitality",
    src: photo("portrait-hospitality"),
    alt: "Chef in whites working the pass in a commercial kitchen",
    final: "600 × 800",
    brief: "Chef in whites, kitchen background.",
    position: "50% 25%",
  },
  {
    label: "Manufacturing",
    src: photo("portrait-manufacturing"),
    alt: "Workshop technician in a hard hat and safety glasses at a grinder",
    final: "600 × 800",
    brief: "Production or workshop worker in PPE.",
    position: "50% 30%",
  },
  {
    label: "Logistics",
    src: photo("portrait-logistics"),
    alt: "Warehouse worker standing among stock",
    final: "600 × 800",
    brief: "Warehouse worker, racking or stock background.",
    position: "50% 35%",
  },
  {
    label: "Security",
    src: photo("portrait-security"),
    alt: "Security officer in a hi-vis vest on patrol",
    final: "600 × 800",
    brief: "Security officer in uniform, no company insignia.",
    position: "55% 25%",
  },
];

const industry = (
  slug: string,
  file: string,
  alt: string,
  position: string,
): [string, UmoraImage] => [
  slug,
  { src: photo(`industry-${file}`), alt, final: "800 × 540", brief: `${alt}; candid, landscape.`, position },
];

export const industryImages: Record<string, UmoraImage> = Object.fromEntries([
  industry("retail", "retail", "Cashier serving a customer at a produce store", "50% 55%"),
  industry("hospitality", "hospitality", "Hotel reception desk with a staff member", "50% 55%"),
  industry("restaurants", "restaurants", "Chefs working a busy restaurant kitchen", "50% 50%"),
  industry("manufacturing", "manufacturing", "Production-floor team at their stations", "62% 50%"),
  industry("logistics", "logistics", "Warehouse aisle with staff in hi-vis", "50% 50%"),
  industry("security", "security", "Security officer on street patrol", "50% 45%"),
  industry("cleaning", "cleaning", "Cleaner vacuuming a modern office", "60% 55%"),
  industry("construction", "construction", "Construction workers in hard hats measuring a wall", "50% 40%"),
  industry("mining-contractors", "mining", "Mine worker in an underground tunnel", "50% 55%"),
  industry("agriculture", "agriculture", "Farm workers harvesting leafy greens", "45% 60%"),
  industry("field-service", "field-service", "Electrician servicing an outdoor meter", "45% 45%"),
]);

export const clockInSelfie: UmoraImage = {
  src: photo("clockin-selfie"),
  alt: "Employee clock-in verification photo",
  final: "400 × 400 (square, face centred)",
  brief: "Head-and-shoulders, face centred, soft background.",
  position: "50% 30%",
};

export const ctaJourney: UmoraImage = {
  src: photo("cta-journey"),
  alt: "Small group silhouetted on a ridge at sunset",
  final: "1800 × 700 (panoramic)",
  brief: "Silhouetted group on a rising ridge at sunrise or sunset, warm sky, dark foreground.",
  position: "50% 30%",
};
