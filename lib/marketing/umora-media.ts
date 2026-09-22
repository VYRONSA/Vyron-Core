// Every photograph on the UMORA public site is referenced from here, so the
// imagery can be replaced without touching layout code.
//
// All files in /public/umora/photos/ are licensed stock photographs, and none
// of them shows an identifiable person: free stock licences do not include
// model releases, so that risk is avoided rather than accepted. Source,
// photographer, licence and the verification note for each one are recorded in
// docs/marketing/UMORA-MEDIA-LICENSES.md — update that record whenever an
// image here changes.
//
// A `src` of null means REQUIRES_APPROVED_IMAGE: the slot renders a branded
// placeholder until a licensed, model-released image is approved for it.

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

// REQUIRES_APPROVED_IMAGE. The hero needs a person at close range, and every
// free-licence candidate that worked compositionally had a recognisable face
// at full resolution. See docs/marketing/UMORA-MEDIA-LICENSES.md for the brief.
export const heroPerson: UmoraImage = {
  src: null,
  alt: "Workforce photograph pending approval",
  final: "1200 × 1600 (portrait), dark café background",
  brief: "Front-of-house worker at close range in a warm, dark interior. Needs a purchased model-released image.",
  position: "35% 30%",
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

// REQUIRES_APPROVED_IMAGE. This slot must show a recognisable face (it
// illustrates photo-verified clocking), so it needs a purchased, model-released
// image. See docs/marketing/UMORA-MEDIA-LICENSES.md for the purchase brief.
export const clockInSelfie: UmoraImage = {
  src: null,
  alt: "Employee clock-in verification photo",
  final: "400 × 400 (square, face centred)",
  brief: "Head-and-shoulders, face centred, soft background. Needs a purchased model-released image.",
  position: "50% 30%",
};

export const ctaJourney: UmoraImage = {
  src: photo("cta-journey"),
  alt: "Small group silhouetted on a ridge at sunset",
  final: "1800 × 700 (panoramic)",
  brief: "Silhouetted group on a rising ridge at sunrise or sunset, warm sky, dark foreground.",
  position: "50% 30%",
};
