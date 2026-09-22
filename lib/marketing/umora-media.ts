// Every photograph on the UMORA public site is referenced from here, so the
// imagery can be replaced without touching layout code.
//
// Two kinds of image live in /public/umora/photos/:
//
//   * Custom-generated UMORA marketing assets (the hero and the clock-in
//     avatar). Commissioned for UMORA, not stock, and they depict no real
//     person, so no stock licence or model release applies to them.
//   * Licensed stock photographs for the workforce cards and industry tiles.
//     None of those shows an identifiable person, because free stock licences
//     do not include model releases and that risk is avoided rather than
//     accepted.
//
// Source, licence and the verification note for every asset are recorded in
// docs/marketing/UMORA-MEDIA-LICENSES.md — update that record whenever an
// image here changes.
//
// A `src` of null means REQUIRES_APPROVED_IMAGE: the slot renders a branded
// placeholder until an approved image exists for it.

export type UmoraImage = {
  /** null means REQUIRES_APPROVED_IMAGE: the slot renders a branded placeholder. */
  src: string | null;
  alt: string;
  /** Minimum pixel size for the production asset. */
  final: string;
  /** What the photograph must show. */
  brief: string;
  /** CSS object-position focus point for this photograph's crop. */
  position?: string;
};

const photo = (name: string) => `/umora/photos/${name}.jpg`;

// Custom-generated UMORA marketing asset (no real person depicted).
export const heroPerson: UmoraImage = {
  src: photo("hero-person"),
  alt: "Café team member in an apron smiling while holding a tablet behind the counter",
  final: "1536 × 1024, warm café interior",
  brief: "Front-of-house worker at close range in a warm café interior, dark apron, shallow depth of field.",
  position: "53% 22%",
};

export const workforcePortraits: (UmoraImage & { label: string })[] = [
  {
    label: "Retail",
    src: photo("portrait-retail"),
    alt: "Checkout assistant weighing produce at a supermarket till",
    final: "600 × 800",
    brief: "Retail service moment (hands/till), store interior; no identifiable face.",
    position: "50% 52%",
  },
  {
    label: "Hospitality",
    src: photo("portrait-hospitality"),
    alt: "Chef plating a dish in a professional kitchen",
    final: "600 × 800",
    brief: "Chef at work in whites; no identifiable face.",
    position: "50% 45%",
  },
  {
    label: "Manufacturing",
    src: photo("portrait-manufacturing"),
    alt: "Factory worker in a hard hat and ear defenders on the production floor",
    final: "600 × 800",
    brief: "Production worker in PPE, seen from behind; no identifiable face.",
    position: "50% 35%",
  },
  {
    label: "Logistics",
    src: photo("portrait-logistics"),
    alt: "Depot worker in a hi-vis overall wheeling a sack truck to a loading dock",
    final: "600 × 800",
    brief: "Warehouse or depot worker, seen from behind or with face not visible.",
    position: "60% 55%",
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
  industry("retail", "retail", "Store worker arranging fresh produce on a display", "50% 50%"),
  industry("hospitality", "hospitality", "Hotel reception desk with a staff member", "50% 55%"),
  industry("restaurants", "restaurants", "Chef finishing plated dishes along a kitchen pass", "60% 50%"),
  industry("manufacturing", "manufacturing", "Worker feeding timber through a production line", "55% 50%"),
  industry("logistics", "logistics", "Warehouse aisle with staff in hi-vis", "50% 50%"),
  industry("security", "security", "Security officer on street patrol", "50% 45%"),
  industry("cleaning", "cleaning", "Cleaner mopping a corridor floor beside a cleaning trolley", "50% 50%"),
  industry("construction", "construction", "Excavator loading a dump truck on an earthworks site", "50% 55%"),
  industry("mining-contractors", "mining", "Mine worker in an underground tunnel", "50% 55%"),
  industry("agriculture", "agriculture", "Farm workers planting seedlings in a field", "50% 62%"),
  industry("field-service", "field-service", "Technician testing an electrical control panel with a multimeter", "50% 45%"),
]);

// Custom-generated UMORA marketing asset (no real person depicted). Cropped to
// the worker's head and shoulders only — the generated phone UI in the source
// image is not used; the phone mockup on the page is the real product UI.
export const clockInSelfie: UmoraImage = {
  src: photo("clockin-selfie"),
  alt: "Site worker in a hard hat smiling at the camera",
  final: "800 × 800 (square, face centred)",
  brief: "Head-and-shoulders, face centred, as captured at clock-in.",
  position: "50% 45%",
};

export const ctaJourney: UmoraImage = {
  src: photo("cta-journey"),
  alt: "Small group silhouetted on a ridge at sunset",
  final: "1800 × 700 (panoramic)",
  brief: "Silhouetted group on a rising ridge at sunrise or sunset, warm sky, dark foreground.",
  position: "50% 30%",
};
