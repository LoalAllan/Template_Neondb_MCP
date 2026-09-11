/**
 * De meetkunde van de verbindingen (variant A: de lichtwaaier; bruikbaar voor
 * elke variant waarin een bron met knopen verbonden wordt).
 *
 * Pure functies, geen DOM: één bron (de lichtbron of de rolknoop), en per
 * cluster één kubische Bézier die daar verticaal uit vertrekt en verticaal in
 * de knoop landt. Beide raaklijnen staan bewust loodrecht — daardoor bundelen de lijnen
 * samen bij de bron (één herkenbare oorsprong) en staan ze recht op de kaart,
 * hoe ver die ook naar links of rechts ligt.
 *
 * Alles rekent in overlay-coördinaten: (0,0) is de linkerbovenhoek van het
 * lichtveld, x loopt mee met het venster (dus NIET met de geschoven rij).
 *
 * Zie docs/design-brief-connector.md, bijlage A, voor de betekenis van elk getal.
 */

/** Hoogte van het lichtveld tussen de standenkiezer en de bovenkant van de kaarten. */
export const VELD_HOOGTE = 132;

/** Waar de bron hangt: net onder de standenkiezer, met ruimte voor haar gloed. */
export const BRON_Y = 8;

/**
 * Waar de bundels landen. Vijf pixels bóven de onderrand van het veld, zodat het
 * aanknopingspunt volledig in beeld staat en niet door de SVG-rand wordt
 * doorgesneden — visueel raakt het precies de bovenkant van de kaart.
 */
export const LANDING_Y = VELD_HOOGTE - 5;

/**
 * De vier punten van de bundel. De greep (0.62 van de val) is met de hand
 * afgeregeld: korter en de bocht knikt, langer en verre clusters krijgen een
 * slappe buik die onder de kaarten door lijkt te zakken.
 */
function grepen(x0: number, y0: number, x1: number, y1: number) {
  const greep = Math.max(28, (y1 - y0) * 0.62);
  return {
    p0: { x: x0, y: y0 },
    p1: { x: x0, y: y0 + greep },
    p2: { x: x1, y: y1 - greep },
    p3: { x: x1, y: y1 },
  };
}

/** Het `d`-attribuut van één bundel. */
export function bundelPad(x0: number, y0: number, x1: number, y1: number): string {
  const { p1, p2, p3 } = grepen(x0, y0, x1, y1);
  return `M ${x0} ${y0} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}

/**
 * Het punt op fractie `t` (0..1) van de bundel — hiermee lopen de bolletjes.
 * Bewust zelf uitgerekend in plaats van via `<animateMotion>`: dat herstart bij
 * elke padwijziging, en het pad wijzigt bij élke pixel die de rij opschuift.
 */
export function puntOpBundel(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
): { x: number; y: number } {
  const { p0, p1, p2, p3 } = grepen(x0, y0, x1, y1);
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/**
 * Vaste, deterministische startfase per bundel. Zonder dit lopen alle bolletjes
 * in gelid en leest de waaier als een metronoom; met een irrationele stap
 * (het gulden getal) spreiden ze zich zonder ooit te hergroeperen. Geen
 * Math.random: dezelfde kaart moet er bij elke render hetzelfde uitzien.
 */
export function bolletjeFase(index: number): number {
  return (index * 0.6180339887) % 1;
}
