import type { SVGProps } from "react";

/**
 * Phase 7.10 — built-in default image library for the Service Catalog.
 *
 * These are lightweight, hand-drawn line-art icons (not raster uploads), so
 * they ship with the app bundle and need no storage/backend round-trip.
 * `services.imageUrl` is left `null` until the owner either uploads a custom
 * photo or explicitly picks one of these ("icon:<key>"). When `null`, the UI
 * still shows a suggested icon computed client-side by `suggestIconKey()` —
 * nothing is persisted until the owner confirms it.
 */

type IconProps = SVGProps<SVGSVGElement>;

function base(children: React.ReactNode, props: IconProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

const ShirtIcon = (p: IconProps) => base(
  <path d="M17 6 L24 10 L31 6 L40 12 L35 19 L31 16 V40 H17 V16 L13 19 L8 12 Z" />, p
);

const TrouserIcon = (p: IconProps) => base(
  <path d="M14 6 H34 L36 42 L27 42 L24 18 L21 42 L12 42 Z" />, p
);

const SuitIcon = (p: IconProps) => base(
  <>
    <path d="M17 6 L24 11 L31 6 L40 13 L35 20 L31 16 V40 H17 V16 L13 20 L8 13 Z" />
    <path d="M22 9 L24 22 L26 9" />
  </>, p
);

const NativeWearIcon = (p: IconProps) => base(
  <>
    <path d="M12 8 C 18 4, 30 4, 36 8 L40 40 H8 Z" />
    <path d="M18 8 L21 40 M30 8 L27 40" />
  </>, p
);

const GownIcon = (p: IconProps) => base(
  <path d="M18 5 H30 L32 14 L40 42 H8 L16 14 Z" />, p
);

const WeddingDressIcon = (p: IconProps) => base(
  <>
    <path d="M19 5 H29 L30 12 L40 42 H8 L18 12 Z" />
    <path d="M24 5 V2" />
    <circle cx="24" cy="8" r="1.5" fill="currentColor" />
  </>, p
);

const CurtainIcon = (p: IconProps) => base(
  <>
    <path d="M6 8 H42" />
    <path d="M12 8 C 10 20, 16 24, 12 42" />
    <path d="M20 8 C 18 20, 24 24, 20 42" />
    <path d="M28 8 C 26 20, 32 24, 28 42" />
    <path d="M36 8 C 34 20, 40 24, 36 42" />
  </>, p
);

const BlanketIcon = (p: IconProps) => base(
  <>
    <rect x="7" y="12" width="34" height="26" rx="2" />
    <path d="M7 20 H41 M7 28 H41" />
  </>, p
);

const DuvetIcon = (p: IconProps) => base(
  <>
    <rect x="6" y="10" width="36" height="28" rx="6" />
    <path d="M16 10 V38 M24 10 V38 M32 10 V38" />
  </>, p
);

const PillowIcon = (p: IconProps) => base(
  <path d="M8 16 C 8 12, 12 10, 16 12 C 20 9, 28 9, 32 12 C 36 10, 40 12, 40 16 C 42 20, 42 28, 40 32 C 40 36, 36 38, 32 36 C 28 39, 20 39, 16 36 C 12 38, 8 36, 8 32 C 6 28, 6 20, 8 16 Z" />, p
);

const TowelIcon = (p: IconProps) => base(
  <>
    <rect x="10" y="6" width="28" height="36" rx="2" />
    <path d="M10 14 H38 M10 34 H38" />
  </>, p
);

const RugIcon = (p: IconProps) => base(
  <>
    <rect x="6" y="10" width="36" height="26" rx="2" />
    <rect x="12" y="16" width="24" height="14" rx="1" />
    <path d="M4 12 V34 M44 12 V34" />
  </>, p
);

const CarpetIcon = (p: IconProps) => base(
  <>
    <ellipse cx="14" cy="24" rx="6" ry="16" />
    <path d="M14 8 H34 A16 16 0 0 1 34 40 H14" />
    <path d="M20 12 H30 M20 36 H30" />
  </>, p
);

const SneakersIcon = (p: IconProps) => base(
  <path d="M6 34 H40 C 42 34, 42 30, 39 29 L 30 27 L 22 18 C 20 16, 17 15, 14 16 L 9 18 C 7 19, 6 21, 6 23 Z M 14 16 V26" />, p
);

const LeatherShoeIcon = (p: IconProps) => base(
  <path d="M6 34 H41 C 43 34, 43 29, 40 28 L 26 26 L 20 19 C 18 17, 14 17, 12 19 L 8 23 C 6 25, 6 28, 6 30 Z M12 19 L18 25" />, p
);

const CanvasShoeIcon = (p: IconProps) => base(
  <>
    <path d="M6 34 H40 C 42 34, 42 30, 39 29 L 30 27 L 22 18 C 20 16, 17 15, 14 16 L 9 18 C 7 19, 6 21, 6 23 Z" />
    <path d="M14 16 L18 27 M20 17 L23 27" />
  </>, p
);

const SchoolUniformIcon = (p: IconProps) => base(
  <>
    <path d="M17 6 L24 10 L31 6 L38 12 L34 18 L31 15 V40 H17 V15 L14 18 L10 12 Z" />
    <path d="M22 9 L24 16 L26 9 L24 22 Z" fill="currentColor" stroke="none" />
  </>, p
);

const ChildrensClothesIcon = (p: IconProps) => base(
  <>
    <path d="M19 8 L24 11 L29 8 L35 13 L32 18 L29 15.5 V38 H19 V15.5 L16 18 L13 13 Z" />
    <circle cx="24" cy="20" r="2.5" />
  </>, p
);

export interface DefaultIcon {
  key: string;
  label: string;
  keywords: string[];
  Icon: (props: IconProps) => JSX.Element;
}

export const DEFAULT_SERVICE_ICONS: DefaultIcon[] = [
  { key: "shirt", label: "Shirt", keywords: ["shirt", "top", "blouse", "polo", "t-shirt", "tshirt"], Icon: ShirtIcon },
  { key: "trouser", label: "Trouser", keywords: ["trouser", "trousers", "pant", "pants", "jean", "jeans", "slacks"], Icon: TrouserIcon },
  { key: "suit", label: "Suit", keywords: ["suit", "blazer", "jacket", "coat", "tuxedo"], Icon: SuitIcon },
  { key: "native-wear", label: "Native Wear", keywords: ["native", "agbada", "kaftan", "ankara", "traditional"], Icon: NativeWearIcon },
  { key: "gown", label: "Gown", keywords: ["gown", "dress", "skirt", "frock"], Icon: GownIcon },
  { key: "wedding-dress", label: "Wedding Dress", keywords: ["wedding", "bridal", "bride"], Icon: WeddingDressIcon },
  { key: "curtain", label: "Curtain", keywords: ["curtain", "curtains", "drape", "drapes"], Icon: CurtainIcon },
  { key: "blanket", label: "Blanket", keywords: ["blanket", "throw"], Icon: BlanketIcon },
  { key: "duvet", label: "Duvet", keywords: ["duvet", "comforter", "quilt"], Icon: DuvetIcon },
  { key: "pillow", label: "Pillow", keywords: ["pillow", "pillowcase", "cushion"], Icon: PillowIcon },
  { key: "towel", label: "Towel", keywords: ["towel", "towels", "bath towel"], Icon: TowelIcon },
  { key: "rug", label: "Rug", keywords: ["rug", "mat", "doormat"], Icon: RugIcon },
  { key: "carpet", label: "Carpet", keywords: ["carpet", "carpeting"], Icon: CarpetIcon },
  { key: "sneakers", label: "Sneakers", keywords: ["sneaker", "sneakers", "trainer", "trainers"], Icon: SneakersIcon },
  { key: "leather-shoes", label: "Leather Shoes", keywords: ["leather shoe", "leather shoes", "oxford", "loafer", "loafers"], Icon: LeatherShoeIcon },
  { key: "canvas-shoes", label: "Canvas Shoes", keywords: ["canvas shoe", "canvas shoes", "converse"], Icon: CanvasShoeIcon },
  { key: "school-uniform", label: "School Uniform", keywords: ["school", "uniform"], Icon: SchoolUniformIcon },
  { key: "childrens-clothes", label: "Children's Clothes", keywords: ["children", "child", "kid", "kids", "baby", "toddler", "onesie"], Icon: ChildrensClothesIcon },
];

const ICON_BY_KEY = new Map(DEFAULT_SERVICE_ICONS.map(i => [i.key, i]));

export function getIconByKey(key: string): DefaultIcon | undefined {
  return ICON_BY_KEY.get(key);
}

/** Suggest a default icon key by fuzzy-matching keywords against a service name. Returns null if nothing matches well. */
export function suggestIconKey(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;

  let best: { key: string; score: number } | null = null;
  for (const icon of DEFAULT_SERVICE_ICONS) {
    for (const kw of icon.keywords) {
      if (lower.includes(kw)) {
        // Prefer longer keyword matches (more specific) over short generic ones.
        const score = kw.length;
        if (!best || score > best.score) best = { key: icon.key, score };
      }
    }
  }
  return best?.key ?? null;
}

/** Parse a service's stored imageUrl into a render plan for <ServiceImage>. */
export function resolveServiceImage(name: string, imageUrl: string | null | undefined) {
  if (imageUrl && imageUrl.startsWith("icon:")) {
    const key = imageUrl.slice("icon:".length);
    const icon = getIconByKey(key);
    return { kind: "icon" as const, icon: icon ?? DEFAULT_SERVICE_ICONS[0], isSuggested: false };
  }
  if (imageUrl) {
    return { kind: "photo" as const, url: imageUrl };
  }
  const suggestedKey = suggestIconKey(name);
  const icon = suggestedKey ? getIconByKey(suggestedKey) : undefined;
  return { kind: "icon" as const, icon: icon ?? DEFAULT_SERVICE_ICONS[0], isSuggested: true, isFallback: !icon };
}
