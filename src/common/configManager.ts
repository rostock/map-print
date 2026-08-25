import { type ProjectionOptions } from '@vcmap/core';
import { parseBoolean, parseEnumValue } from '@vcsuite/parsers';
import type { Pattern } from '@vcsuite/check';
import { check, maybe, ofEnum, oneOf, strict } from '@vcsuite/check';
import { reactive } from 'vue';
import { getLogger } from '@vcsuite/logger';
import standardPageSizes from '../pdf/standardPageSizes.js';
import getDefaultOptions from '../defaultOptions.js';
import { name } from '../../package.json';

/** Enumeration of allowed orientations. */
export enum OrientationOptions {
  /** Always landscape orientation. */
  LANDSCAPE = 'landscape',
  /** Always portrait orientation. */
  PORTRAIT = 'portrait',
  /** User can select between landscape and portrait. */
  BOTH = 'both',
}

/** Enumeration of allowed orientations for the legend. */
export enum LegendOrientationOptions {
  /** Always same orientation as the one choosed by the user. */
  SAME_AS_MAP = 'sameAsMap',
  /** Always landscape orientation. */
  LANDSCAPE = 'landscape',
  /** Always portrait orientation. */
  PORTRAIT = 'portrait',
}

export type LegendFormatOptions = keyof typeof standardPageSizes | 'sameAsMap';

/** Contact information printed on pdf. */
export type ContactInfo = {
  /** The department */
  department?: string;
  /** Name of company or city administration */
  name?: string;
  /** Name of street and number */
  streetAddress?: string;
  /** Postal code and city */
  zipAndCity?: string;
  /** Name of Country */
  country?: string;
  /** Mail address */
  mail?: string;
  /** Phone number */
  phone?: string;
  /** Phone number */
  fax?: string;
};

/** Possible contact keys with corresponding type */
export const contactKeysPattern: Record<string, Pattern> = {
  department: maybe(String),
  name: maybe(String),
  streetAddress: maybe(String),
  zipAndCity: maybe(String),
  country: maybe(String),
  mail: maybe(String),
  phone: maybe(String),
  fax: maybe(String),
};

/** Font configuration printed on pdf. */
export type FontConfig = {
  /** Name of the font */
  name?: string;
  /** Path to the regular font file */
  regular?: string;
  /** Path to the bold font file */
  bold?: string;
};

/** Possible font keys with corresponding type */
export const fontKeysPattern: Record<string, Pattern> = {
  name: maybe(String),
  regular: maybe(String),
  bold: maybe(String),
};

/** Width/height of the map area in inches. */
export type MapAreaSize = {
  width: number;
  height: number;
};

/**
 * A selectable variant of the printed map-area size for a given page
 * format. Several variants can be defined for the same `format` (e.g. two
 * differently proportioned "A4" variants) by giving each its own unique
 * `key` — `format` stays a real, jsPDF-compatible page format, only `key`
 * (and optionally `title`) identify the variant in the UI.
 * If a matching variant exists for the selected format, the map area in the
 * PDF is always placed at exactly this size (no letterboxing) instead of
 * being calculated dynamically from the available space.
 */
export type ImageSizeOption = {
  /** Unique key, used as the select value and to persist the user's choice. */
  key: string;
  /** Label shown in the size-variant select. Falls back to `key` when omitted. */
  title?: string;
  /** The underlying jsPDF page format this variant belongs to. */
  format: keyof typeof standardPageSizes;
  /** Map area size (in inch) used in portrait orientation. */
  portrait: MapAreaSize;
  /**
   * Map area size (in inch) used in landscape orientation. Falls back to
   * `portrait` with width/height swapped when omitted.
   */
  landscape?: MapAreaSize;
};

/** Possible keys of a {@link MapAreaSize} with corresponding type. */
const mapAreaSizeKeysPattern: Record<string, Pattern> = {
  width: Number,
  height: Number,
};

/** Possible keys of an {@link ImageSizeOption} with corresponding type. */
const imageSizeOptionKeysPattern: Record<string, Pattern> = {
  key: String,
  title: maybe(String),
  format: oneOf(...Object.keys(standardPageSizes)),
  portrait: strict(mapAreaSizeKeysPattern),
  landscape: maybe(strict(mapAreaSizeKeysPattern)),
};

/**
 * Eine URL-Ersetzungsregel für den Druck: wenn `pattern` als Teilstring in
 * einer Layer-URL vorkommt, wird -- statt den Layer über seinen
 * eigentlichen Typ zu behandeln -- daraus ein regulärer WMS-Layer gebaut
 * (z.B. um einen WMTS-Dienst, der auch als WMS erreichbar ist, beim Druck
 * über den robusteren, direkten WMS-Weg statt Offscreen-Rendering laufen
 * zu lassen).
 */
export type PrintUrlPattern = {
  /** Name/Bezeichner der Regel, nur zur Wiedererkennung in der Config. */
  name: string;
  /** Teilstring, nach dem in Layer-URLs gesucht wird. */
  pattern: string | Array<string>;
  /**
   * Ersetzung: bei completeUrl=true die komplette neue GetMap-URL (inkl.
   * Query-String), sonst nur der Ersatz für den gefundenen Teilstring
   * innerhalb der bestehenden URL.
   */
  replacement: string;
  /** Wenn true, wird die GESAMTE URL durch `replacement` ersetzt statt nur der gefundene Teilstring. */
  completeUrl?: boolean;
};

/** Possible keys of a {@link PrintUrlPattern} with corresponding type. */
const printUrlPatternKeysPattern: Record<string, Pattern> = {
  name: String,
  pattern: oneOf(String, [String]),
  replacement: String,
  completeUrl: maybe(Boolean),
};

/** Configuration options of the print plugin. */
export type PrintConfig = {
  /** List of page formates the user can select from. */
  formatList?: Array<keyof typeof standardPageSizes>;
  /** The default format. Needs to be in formatList. */
  formatDefault?: keyof typeof standardPageSizes;
  /** List of ppi values the user can select from. */
  ppiList?: Array<number>;
  /** The default ppi value. Needs to be in ppiList. */
  ppiDefault?: number;
  /** "landscape", "portrait" or both. If both, user can select from portrait and landscape. Otherwise the selected option is always used. */
  orientationOptions?: OrientationOptions;
  /** The default orientation if orientationOptions is "both". Either "landscape" or "portrait". */
  orientationDefault?:
    | OrientationOptions.LANDSCAPE
    | OrientationOptions.PORTRAIT;
  /** Whether user can insert title or not. */
  allowTitle?: boolean;
  /** Whether user can insert description or not. */
  allowDescription?: boolean;
  /** Whether map logo should be printed in header. */
  printLogo?: boolean;
  /** Whether map info should be printed on pdf. */
  printMapInfo?: boolean;
  /** Whether oblique image name should be printed on pdf. Will be part of MapInfo */
  printObliqueName?: boolean;
  /** Whether link to map should be printed on pdf. Will be part of MapInfo */
  printLinkToMap?: boolean;
  /** Whether link to map should be printed on pdf. Will be part of MapInfo */
  printQR?: boolean;
  /** Whether coordinates should be printed on pdf. Will be part of MapInfo */
  printCoordinates?: boolean;
  /** The projection to be used for the coordinates. */
  coordinatesProj?: ProjectionOptions;
  /** List of resolution the user can choose from for image/jpg creation. */
  resolutionList?: Array<number>;
  /** The default resolution. Needs to be in resolutionList. */
  resolutionDefault?: number;
  /**  The contact information to be printed on PDF. */
  contactDetails?: ContactInfo;
  /** Whether copyright should be printed on pdf or not. */
  printCopyright?: boolean;
  /** Whether FeatureInfo windows should be printed on pdf or not. */
  printFeatureInfo?: boolean;
  /** Whether legend should be printed on pdf or not. */
  printLegend?: boolean;
  /** The page orienation for the legend entries. */
  legendOrientation?: LegendOrientationOptions;
  /** The page format for the legend entries. */
  legendFormat?: LegendFormatOptions;
  /** The default char limitation of the description. */
  charLimit?: number;
  /** Font configuration used for the PDF. */
  font?: FontConfig;
  /**
   * List of selectable map-area size variants (one or more per page
   * format, see {@link ImageSizeOption}). If a variant exists for the
   * currently selected format, the map area in the PDF always fills
   * exactly that size (no letterboxing).
   * @example [{ key: 'A4', format: 'A4', portrait: { width: 7.27, height: 9.29 }, landscape: { width: 10.69, height: 5.87 } }]
   */
  imageSizeList?: Array<ImageSizeOption>;
  /** The key of the default map-area size variant. Needs to be in imageSizeList. */
  imageSizeDefault?: string | undefined;
  /**
   * EPSG-Code (mit menschenlesbarer Bezeichnung, z.B. für die
   * Eckkoordinaten-Beschriftung) der Projektion, in der gedruckt werden
   * soll -- unabhängig von der Live-Render-Projektion der Karte. Sinnvoll,
   * wenn die Karte selbst in einer Projektion mit breitengradabhängiger
   * Maßstabsverzerrung rendert (z.B. EPSG:3857 / Web-Mercator) -- ohne
   * printEPSG würde der gedruckte Maßstab dann nicht stimmen. Ohne Angabe
   * wird die Live-Projektion der Karte verwendet.
   */
  printEPSG?: PrintEPSG | undefined;
  /**
   * Regeln, um Layer-URLs vor dem Druck zu ersetzen (z.B. WMTS -> WMS für
   * einen Dienst, der beides anbietet). Der erste Treffer gewinnt.
   */
  pattern?: Array<PrintUrlPattern>;
};

export type PrintState = {
  selectedFormat: keyof typeof standardPageSizes;
  selectedPpi: number;
  selectedOrientation:
    | OrientationOptions.LANDSCAPE
    | OrientationOptions.PORTRAIT;
  title: string;
  description: string;
  selectedResolution: number;
  /** The key of the currently selected map-area size variant (see {@link ImageSizeOption}), if any is applicable for selectedFormat. */
  selectedImageSize?: string;
};

/**
 * EPSG-Code der Druck-Projektion mit menschenlesbarer Bezeichnung, z.B.
 * für die Eckkoordinaten-Beschriftung auf dem PDF.
 */
export type PrintEPSG = {
  /** EPSG-Code als Zahl, z.B. 25833. */
  key: number;
  /** Menschenlesbare Bezeichnung, z.B. 'ETRS89/UTM-33N'. */
  name: string;
};

/** Possible keys of a {@link PrintEPSG} with corresponding type. */
const printEPSGKeysPattern: Record<string, Pattern> = {
  key: Number,
  name: String,
};

/**
 * Normalisiert einen EPSG-Code (blanke Zahl oder String) auf die volle
 * 'EPSG:xxxx'-Form, wie sie OpenLayers/WMS erwarten. Ein bereits mit
 * 'EPSG:' beginnender String bleibt unveraendert.
 */
export function normalizeEpsgCode(value: number | string): string {
  const raw = String(value).trim();
  return raw.toUpperCase().startsWith('EPSG:') ? raw : `EPSG:${raw}`;
}

/**
 * Parses the default config as well as the custom map plugin config and merges them.
 * @param  config The config which is defined when setting up the map.
 * @param  defaultOptions The default plugin config inside the source code of the plugin.
 * @returns Setup config and state of the plugin.
 */
export function getConfigAndState(
  config: PrintConfig,
  defaultOptions: Required<PrintConfig>,
): { config: Required<PrintConfig>; state: PrintState } {
  /**
   * Selectable map-area size variants (0..n per page format). Not merged
   * with defaultOptions when explicitly set to an empty array by the user
   * (an empty list is a valid, meaningful choice: "no fixed sizes, always
   * calculate dynamically") — only falls back to defaultOptions when
   * entirely unset. Computed early so formatList/formatDefault below can
   * derive from it when not explicitly configured.
   * @example [{ key: 'A4', format: 'A4', portrait: { width: 7.27, height: 9.29 }, landscape: { width: 10.69, height: 5.87 } }]
   */
  const imageSizeList: Array<ImageSizeOption> =
    config.imageSizeList ?? defaultOptions.imageSizeList ?? [];

  /**
   * available format list. When not explicitly set, derived from the
   * formats used in imageSizeList (deduplicated, in their given order) —
   * so a config only listing imageSizeList doesn't need to redundantly
   * repeat the same format names in formatList. Only falls back to
   * defaultOptions.formatList when neither is given.
   * @example ['A2', 'A3', 'A4', 'A5']
   * @api
   */
  const formatList: Array<keyof typeof standardPageSizes> =
    config.formatList ||
    (imageSizeList.length
      ? [...new Set(imageSizeList.map((option) => option.format))]
      : defaultOptions.formatList);

  /**
   * The default page format. When not explicitly set, derived from the
   * format of the default (or, lacking that, first) imageSizeList variant,
   * falling back to defaultOptions.formatDefault.
   * @example 'A4'
   */
  const formatDefault: keyof typeof standardPageSizes =
    config.formatDefault ||
    imageSizeList.find((option) => option.key === config.imageSizeDefault)
      ?.format ||
    imageSizeList[0]?.format ||
    defaultOptions.formatDefault;

  /**
   * available values for pixel per inch (PPI)
   * @example [75, 150, 300, 450, 600]
   */
  const ppiList: Array<number> = config.ppiList || defaultOptions.ppiList;

  /**
   * The default value for pixel per inch (PPI)
   * @example 300
   */
  const ppiDefault: number = config.ppiDefault || defaultOptions.ppiDefault;

  /**
   * @example "both"
   */
  const orientationOptions: OrientationOptions = parseEnumValue(
    config.orientationOptions,
    OrientationOptions,
    defaultOptions.orientationOptions,
  );

  /**
   * @example "landscape"
   */
  const orientationDefault:
    | OrientationOptions.LANDSCAPE
    | OrientationOptions.PORTRAIT =
    orientationOptions !== OrientationOptions.BOTH
      ? // if the OrientationOption is not BOTH, the default orientation equals the OrientationOption
        orientationOptions
      : (parseEnumValue(
          config.orientationDefault,
          OrientationOptions,
          defaultOptions.orientationDefault,
        ) as OrientationOptions.LANDSCAPE | OrientationOptions.PORTRAIT);

  /**
   * Whether the user should be able to add title or not.
   */
  const allowTitle: boolean = parseBoolean(
    config.allowTitle,
    defaultOptions.allowTitle,
  );

  /**
   * Whether the user should be able to add description or not.
   */
  const allowDescription: boolean = parseBoolean(
    config.allowDescription,
    defaultOptions.allowDescription,
  );

  /**
   * Whether logo should be printed on pdf or not.
   */
  const printLogo: boolean = parseBoolean(
    config.printLogo,
    defaultOptions.printLogo,
  );

  /**
   * Whether copyright should be printed on pdf or not.
   */
  const printCopyright: boolean = parseBoolean(
    config.printCopyright,
    defaultOptions.printCopyright,
  );

  /** Whether FeatureInfo windows should be printed on pdf or not. */
  const printFeatureInfo: boolean = parseBoolean(
    config.printFeatureInfo,
    defaultOptions.printFeatureInfo,
  );

  /**
   * Whether legend should be printed on pdf or not.
   */
  const printLegend: boolean = parseBoolean(
    config.printLegend,
    defaultOptions.printLegend,
  );

  /**
   * @example "sameAsMap"
   */
  const legendOrientation: LegendOrientationOptions = parseEnumValue(
    config.legendOrientation,
    LegendOrientationOptions,
    defaultOptions.legendOrientation,
  );

  /**
   * @example "sameAsMap"
   */
  const legendFormat: LegendFormatOptions =
    config.legendFormat || defaultOptions.legendFormat;

  /**
   * Whether map information should be printed on pdf or not.
   */
  const printMapInfo: boolean = parseBoolean(
    config.printMapInfo,
    defaultOptions.printMapInfo,
  );

  const printObliqueName: boolean = parseBoolean(
    config.printObliqueName,
    defaultOptions.printObliqueName,
  );

  const printLinkToMap: boolean = parseBoolean(
    config.printLinkToMap,
    defaultOptions.printLinkToMap,
  );

  /**
   * Whether a QR code linking to the map should be printed on pdf or not.
   */
  const printQR: boolean = parseBoolean(
    config.printQR,
    defaultOptions.printQR,
  );

  const printCoordinates: boolean = parseBoolean(
    config.printCoordinates,
    defaultOptions.printCoordinates,
  );

  /**
   * max. char in the description.
   */
  const charLimit: number =
    config.charLimit || defaultOptions.charLimit;

  const coordinatesProj: ProjectionOptions =
    config.coordinatesProj || defaultOptions.coordinatesProj;

  // screenshot
  /**
   * Available resolutions for screenshot. The value is always the longest side of the image.
   */
  const resolutionList: Array<number> =
    config.resolutionList || defaultOptions.resolutionList;

  /**
   * The default resolution
   * @example 1920
   */
  const resolutionDefault: number =
    config.resolutionDefault || defaultOptions.resolutionDefault;

  /**
   * The contact information to be printed on pdf
   * @example ['Virtual City Systems', 'Tauentzienstr. 7 b/c', '10789 Berlin', 'Germany', 'Tel.: +49 30 89048710']
   */
  const contactDetails: ContactInfo =
    config.contactDetails || defaultOptions.contactDetails;

  const font: FontConfig =
    config.font || defaultOptions.font;

  /**
   * EPSG-Code (mit Bezeichnung) der Druck-Projektion, falls abweichend von
   * der Live-Render-Projektion der Karte konfiguriert.
   */
  const printEPSG: PrintEPSG | undefined =
    config.printEPSG || defaultOptions.printEPSG;

  /**
   * Regeln, um Layer-URLs vor dem Druck zu ersetzen (z.B. WMTS -> WMS).
   */
  const pattern: Array<PrintUrlPattern> =
    config.pattern || defaultOptions.pattern;

  /**
   * The key of the default map-area size variant. Falls back to the first
   * variant matching formatDefault, if any.
   * @example 'A4'
   */
  const imageSizeDefault: string | undefined =
    config.imageSizeDefault ??
    defaultOptions.imageSizeDefault ??
    imageSizeList.find((option) => option.format === formatDefault)?.key;

  return {
    // setup configuration of the plugin
    config: {
      formatList,
      formatDefault,
      ppiList,
      ppiDefault,
      orientationOptions,
      orientationDefault,
      allowTitle,
      allowDescription,
      printLogo,
      printCopyright,
      printFeatureInfo,
      printLegend,
      legendOrientation,
      legendFormat,
      printMapInfo,
      printObliqueName,
      printLinkToMap,
      printQR,
      printCoordinates,
      coordinatesProj,
      contactDetails,
      charLimit,
      font,
      imageSizeList,
      imageSizeDefault,
      printEPSG,
      pattern,
      // screenshot
      resolutionList,
      resolutionDefault,
    },
    // initial and reactive state of the plugin.
    state: reactive({
      selectedFormat: formatDefault,
      selectedPpi: ppiDefault,
      selectedOrientation: orientationDefault,
      title: '',
      description: '',
      selectedImageSize: imageSizeDefault,
      // screenshot
      selectedResolution: resolutionDefault,
    }),
  };
}

export function validate(options: PrintConfig): void {
  const defaultOptions = getDefaultOptions();
  try {
    check(
      options.imageSizeList,
      maybe([strict(imageSizeOptionKeysPattern)]),
    );
    const imageSizeList =
      options.imageSizeList || defaultOptions.imageSizeList || [];

    check(
      options.formatList,
      maybe([oneOf(...Object.keys(standardPageSizes))]),
    );
    // Mirrors the derivation in getConfigAndState: formatList falls back to
    // the formats used in imageSizeList before falling back to
    // defaultOptions.formatList — so a config that only sets imageSizeList
    // (and a matching formatDefault) validates correctly.
    const formatList =
      options.formatList ||
      (imageSizeList.length
        ? [...new Set(imageSizeList.map((option) => option.format))]
        : defaultOptions.formatList);
    check(options.formatDefault, maybe(oneOf(...formatList)));
    check(options.ppiList, maybe([Number]));
    const ppiList = options.ppiList || defaultOptions.ppiList;
    check(options.ppiDefault, maybe(oneOf(...ppiList)));
    check(options.orientationOptions, maybe(ofEnum(OrientationOptions)));
    check(
      options.orientationDefault,
      maybe(oneOf(OrientationOptions.LANDSCAPE, OrientationOptions.PORTRAIT)),
    );
    check(options.allowTitle, maybe(Boolean));
    check(options.allowDescription, maybe(Boolean));
    check(options.printLogo, maybe(Boolean));
    check(options.printCopyright, maybe(Boolean));
    check(options.printFeatureInfo, maybe(Boolean));
    check(options.printLegend, maybe(Boolean));
    check(
      options.legendFormat,
      maybe(oneOf(...Object.keys(standardPageSizes), 'sameAsMap')),
    );
    check(options.legendOrientation, maybe(ofEnum(LegendOrientationOptions)));
    check(options.printMapInfo, maybe(Boolean));
    check(options.printObliqueName, maybe(Boolean));
    check(options.printLinkToMap, maybe(Boolean));
    check(options.printQR, maybe(Boolean));
    check(options.printCoordinates, maybe(Boolean));
    check(options.coordinatesProj, maybe({ type: String, epsg: String }));
    check(options.resolutionList, maybe([Number]));
    const resolutionList =
      options.resolutionList || defaultOptions.resolutionList;
    check(options.resolutionDefault, maybe(oneOf(...resolutionList)));
    check(options.contactDetails, maybe(strict(contactKeysPattern)));
    check(options.font, maybe(strict(fontKeysPattern)));
    check(
      options.imageSizeDefault,
      maybe(oneOf(...imageSizeList.map((option) => option.key))),
    );
    check(options.printEPSG, maybe(strict(printEPSGKeysPattern)));
    check(options.pattern, maybe([strict(printUrlPatternKeysPattern)]));
  } catch (err) {
    getLogger(name).error('Invalid config', err);
  }
}