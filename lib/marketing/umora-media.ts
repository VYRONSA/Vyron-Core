// Every photograph on the UMORA landing page is referenced from here, so the
// imagery can be replaced without touching layout code.
//
// INTERIM ASSETS: the files in /public/umora/interim/ are low-resolution crops
// taken from the approved UMORA landing-page design reference and upscaled.
// They exist so the page carries the reference's photographic composition
// today. Before production launch, replace each one with a licensed,
// high-resolution original at (at least) the `final` size listed, keeping the
// same framing, and update `src` below. The people shown are illustrative and
// are not presented as customers.

export type UmoraImage = {
  src: string;
  alt: string;
  /** Minimum pixel size for the licensed production asset. */
  final: string;
  /** What the production photograph must show. */
  brief: string;
};

const interim = (name: string) => `/umora/interim/${name}.jpg`;

export const heroPerson: UmoraImage = {
  src: interim("hero-person"),
  alt: "Smiling team member in a black apron at work in a café",
  final: "1200 × 1600 (portrait), dark café background",
  brief: "Front-of-house worker, warm smile, looking off-camera left, black apron, shallow depth of field.",
};

export const workforcePortraits: (UmoraImage & { label: string })[] = [
  {
    label: "Retail",
    src: interim("portrait-retail"),
    alt: "Retail team member in a store",
    final: "600 × 800",
    brief: "Retail associate in apron, bright store interior.",
  },
  {
    label: "Hospitality",
    src: interim("portrait-hospitality"),
    alt: "Chef in whites in a commercial kitchen",
    final: "600 × 800",
    brief: "Chef in whites and toque, kitchen background.",
  },
  {
    label: "Manufacturing",
    src: interim("portrait-manufacturing"),
    alt: "Production worker wearing a hairnet on a factory floor",
    final: "600 × 800",
    brief: "Production worker with hairnet and apron, factory floor.",
  },
  {
    label: "Logistics",
    src: interim("portrait-logistics"),
    alt: "Warehouse worker in a high-visibility vest",
    final: "600 × 800",
    brief: "Warehouse worker in cap and hi-vis vest, racking background.",
  },
  {
    label: "Security",
    src: interim("portrait-security"),
    alt: "Security officer in uniform",
    final: "600 × 800",
    brief: "Security officer in dark uniform and cap.",
  },
];

export const industryImages: Record<string, UmoraImage> = Object.fromEntries(
  [
    ["retail", "Retail staff serving a customer"],
    ["hospitality", "Hospitality staff at work"],
    ["restaurants", "Restaurant team member at the pass"],
    ["manufacturing", "Manufacturing workers on a production line"],
    ["logistics", "Logistics team at a depot"],
    ["security", "Security officers on site"],
    ["cleaning", "Cleaning team on a customer site"],
    ["construction", "Construction worker in a hard hat"],
    ["mining-contractors", "Mining contractor at sunset"],
    ["agriculture", "Farm worker in the field"],
    ["field-service", "Field service technicians on site"],
  ].map(([slug, alt]) => [
    slug,
    {
      src: interim(`industry-${slug === "mining-contractors" ? "mining" : slug}`),
      alt,
      final: "800 × 540",
      brief: `${alt}; natural light, candid, landscape.`,
    },
  ]),
);

export const clockInSelfie: UmoraImage = {
  src: interim("clockin-selfie"),
  alt: "Employee clock-in verification photo",
  final: "400 × 400 (square, face centred)",
  brief: "Head-and-shoulders selfie, neutral background, as captured at clock-in.",
};

export const ctaJourney: UmoraImage = {
  src: interim("cta-journey"),
  alt: "Team hiking up a ridge at sunrise",
  final: "1800 × 700 (panoramic)",
  brief: "Silhouetted group walking uphill at sunrise, warm sky, dark foreground.",
};
