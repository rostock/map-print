import type { LegendItem } from '@vcmap/ui';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { JSPDF_PPI } from '../common/util.js';
import pageSizes from './standardPageSizes.js';
import type { PageStyle } from './styles.js';
import { pageStyles, fontWeights } from './styles.js';
import {
  LegendOrientationOptions,
  OrientationOptions,
} from '../common/configManager.js';
import getDefaultOptions from '../defaultOptions.js';
import { addLayerLegend } from './pdfLegendHelper.js';

/** 2D coordinates. Origin is upper left corner. */
export type Coords = {
  x: number;
  y: number;
};

/** Dimension of Element */
export type Size = {
  width: number;
  height: number;
};

export type ElementPlacement = {
  /**  Coordinates of upper left corner in inches. Origin is upper left corner of pdf document. */
  coords: Coords;
  /** width and height */
  size: Size;
};

export type CanvasAndPlacement = {
  canvas: HTMLCanvasElement;
  placement: ElementPlacement;
};

export type TextWithHeader = {
  header: string;
  text: Array<string>;
};

export type PrintableLegendItems = Array<{
  title: string;
  legends: Array<LegendItem>;
}>;

type Legend = {
  config: {
    format: keyof typeof pageSizes;
    orientation:
    | LegendOrientationOptions.LANDSCAPE
    | LegendOrientationOptions.PORTRAIT;
  };
  items: PrintableLegendItems;
};

export type PDFCreatorOptions = {
  /** The scale of the given map */
  scale?: string;
  /**
   * Numerischer Maßstabsnenner (z.B. 1000 für 1:1000) — Grundlage für den
   * grafischen Maßstabsbalken. Ohne diesen Wert wird kein Balken gezeichnet.
   */
  scaleDenominator?: number;
  /**
   * Richtung von Nordnach oben auf der Seite, im Uhrzeigersinn, in
   * Bogenmaß (0 = Norden zeigt gerade nach oben). Wird genutzt, um den
   * Nordpfeil passend zur Rotation des Druckbereich-Rechtecks zu drehen.
   * Unset/0, wenn keine Rotation vorliegt.
   */
  northArrowRotation?: number;
  /**
   * Karten-Koordinaten der oberen rechten Ecke des Kartenbereichs (nach
   * Rotation, d.h. wie sie tatsaechlich oben rechts auf der fertigen Seite
   * liegt). X wird horizontal oberhalb der Karte beschriftet (rechtsbuendig
   * zur rechten Kartenkante), Y senkrecht (90° gedreht) rechts neben der
   * Karte. Ohne diese Angabe werden keine Eck-Koordinaten gedruckt.
   */
  topRightCoordinate?: { x: number; y: number };
  /**
   * Karten-Koordinaten der unteren linken Ecke des Kartenbereichs (nach
   * Rotation). X wird horizontal unterhalb der Karte beschriftet
   * (linksbuendig zur linken Kartenkante), Y senkrecht links neben der
   * Karte. Ohne diese Angabe werden keine Eck-Koordinaten gedruckt.
   */
  bottomLeftCoordinate?: { x: number; y: number };
  /**
   * Menschenlesbare Bezeichnung der Projektion (z.B. 'ETRS89/UTM-33N'),
   * wird in Klammern hinter den X-Werten der Eckkoordinaten gedruckt.
   */
  crsName?: string;
  /** The orientation of the PDF. */
  orientation: OrientationOptions.LANDSCAPE | OrientationOptions.PORTRAIT;
  /** The format of the PDF. */
  format: keyof typeof pageSizes;
  /** The title at the beginning of the PDF. */
  title?: string;
  /** The map logo. */
  logo?: HTMLImageElement;
  /** The aspect ratio of the input image. Used as fallback when `imageSize` is not set. */
  imgRatio: number;
  /**
   * Feste, konfigurierte Größe des Kartenbereichs (in Inch), z.B. aus
   * `formatList[format][orientation]` der Plugin-Konfiguration. Wenn
   * gesetzt, wird der Kartenbereich exakt in dieser Größe platziert
   * (zentriert, kein Letterboxing) statt dynamisch anhand des
   * verfügbaren Platzes und des Bild-Seitenverhältnisses berechnet zu
   * werden.
   */
  imageSize?: Size;
  /** The description below the image. */
  description?: string;
  /** The contact information in the lower left corner. */
  contact?: TextWithHeader;
  /** Information about the map content. */
  mapInfo?: TextWithHeader;
  /** Link to the map. */
  mapLink?: string;
  /** Link to the map. */
  qrLink?: string;
  /** Information about the copyright. */
  copyright?: string;
  /** Information about the legend. */
  legend?: Legend;
  /** Paths to bold and regular weight for named font. */
  fonts?: { name: string; bold: string; regular: string };
};

const defaultOptions = getDefaultOptions();

/**
 * Rohes SVG-Markup des Nordpfeils, viewBox auf die Bounding Box des
 * Pfades zugeschnitten (Original-viewBox war eine leere A4-Seite,
 * 210x297mm, in der die Form nur einen kleinen Bereich einnahm). Wird
 * von {@link PDFCreator._renderNorthArrow} zur Laufzeit rotiert
 * gerastert.
 */
const NORTH_ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="41 69 137 161"><path fill="#141414" d="M 46.238169,224.71279 C 72.181446,167.45124 108.38026,74.363002 109.38949,74.231023 c 0,0 63.49396,150.124917 63.1308,150.738087 -0.26682,0.45052 -63.14608,-52.84225 -63.14608,-52.84225 0,0 -63.652921,53.72678 -63.136041,52.58593 z m 63.113211,-58.87684 c 0.0918,0.0318 50.97763,42.48485 50.97763,42.48485 0,0 -50.77874,-121.654357 -50.93588,-121.654357 C 97.202088,115.19917 58.135598,208.38115 58.527254,208.36865 c 0.283928,-0.008 50.197296,-42.74996 50.824126,-42.5327 z m -0.0496,-5.04515 c -0.38104,-0.31271 0.21746,-62.467537 0.21746,-62.467537 0,0 38.01819,93.845587 37.63937,93.534707 z"/></svg>`;


export default class PDFCreator {
  initialized = false;

  // eslint-disable-next-line new-cap
  pdfDoc = new jsPDF(
    defaultOptions.orientationDefault,
    'in',
    defaultOptions.formatDefault,
  );

  formatting = pageStyles.default;

  /** Size of PDF depending on input format. */
  pdfSize: Size =
    defaultOptions.orientationDefault === OrientationOptions.PORTRAIT
      ? {
        width: pageSizes[defaultOptions.formatDefault][0],
        height: pageSizes[defaultOptions.formatDefault][1],
      }
      : {
        width: pageSizes[defaultOptions.formatDefault][1],
        height: pageSizes[defaultOptions.formatDefault][0],
      };

  /** The line width where content can be added (excluding margins). */
  maxLineWidth =
    this.pdfSize.width -
    this.formatting.pageMargins[1] -
    this.formatting.pageMargins[3];

  font = 'helvetica';

  /** The orientation of the pdf. */
  orientation: OrientationOptions.LANDSCAPE | OrientationOptions.PORTRAIT =
    defaultOptions.orientationDefault;

  /**
   * The title string of the pdf splitted according to line length.
   * Each element of array is new line.
   * If title is longer than maxLineCount defined in styles.js it is shortend.
   * 'undefined' if no input title available.
   */
  title?: Array<string>;

  /** Position and dimensions of the title. */
  titlePlacement?: ElementPlacement;

  /** The navbar logo from the map which is printed in the upper right corner. */
  logo?: HTMLImageElement;

  /** Position and dimensions of the logo. */
  logoPlacement?: ElementPlacement;

  /** Data URL of the QR code linking to the map, printed in the upper left corner. */
  qrCode?: string;

  /** Position and dimensions of the QR code. */
  qrCodePlacement?: ElementPlacement;

  /** Contact information already splitted by configManager. */
  contact?: TextWithHeader;

  /** Position and dimensions of the contact information. */
  contactPlacement?: ElementPlacement;

  /** Map info provided by mapInfoCollector. */
  mapInfo?: TextWithHeader;

  /** Position and dimensions of the map information. */
  mapInfoPlacement?: ElementPlacement;

  /** Map link. */
  mapLink?: string;

  /**
   * The description string of the pdf splitted according to line length.
   * Each element of array is new line.
   * If description is longer than maxLineCount defined in styles.js it is shortend.
   * `undefined` if no input description available.
   */
  description?: Array<string>;

  /** Position and dimensions of the description. */
  descriptionPlacement?: ElementPlacement;

  /** Position and dimensions of the image. */
  imgPlacement: ElementPlacement | undefined;

  /** Unique copyright from all active layers. */
  copyright?: string;

  /** Position and dimensions of the copyright. */
  copyrightPlacement?: ElementPlacement;

  /** Legend config and items. */
  legend?: Legend;

  /** Scale of the map */
  scale?: string;

  /** Numerischer Maßstabsnenner für den grafischen Maßstabsbalken. */
  scaleDenominator?: number;

  /** Richtung von Norden nach oben auf der Seite (im Uhrzeigersinn, Bogenmaß) für den Nordpfeil. */
  northArrowRotation?: number;

  /** Karten-Koordinaten der oberen rechten Ecke, siehe PDFCreatorOptions.topRightCoordinate. */
  topRightCoordinate?: { x: number; y: number };

  /** Karten-Koordinaten der unteren linken Ecke, siehe PDFCreatorOptions.bottomLeftCoordinate. */
  bottomLeftCoordinate?: { x: number; y: number };

  /** Bezeichnung der Druck-Projektion, siehe PDFCreatorOptions.crsName. */
  crsName?: string;

  /** Data-URL (PNG) des vorgerenderten, bereits rotierten Nordpfeils, siehe {@link _renderNorthArrow}. */
  private northArrowImage?: string;

  /**
   * Höhe (in Zoll) der Grafikzeile mit Maßstabsbalken und Nordpfeil
   * innerhalb der Karteninformation-Box. Wird sowohl bei der
   * Platzierungsberechnung ({@link _calcMapInfoPlacement}) als auch beim
   * eigentlichen Zeichnen ({@link _drawScaleBar}, {@link _drawNorthArrow})
   * verwendet, damit reservierter Platz und tatsächliche Zeichnung
   * übereinstimmen.
   */
  private readonly mapInfoGraphicsHeight = 0.32;

  /** Abstand (in Zoll) zwischen dem Textblock der Karteninformation und der Grafikzeile. */
  private readonly mapInfoGraphicsGap = 0.04;

  /**
   * Höhe (in Zoll) des Nordpfeils — Basiswert doppelt so groß wie die
   * nominelle Grafikzeilen-Höhe ({@link mapInfoGraphicsHeight}), plus 1cm
   * (~0,3937in) zusätzliche Höhe auf Wunsch. Da er die
   * mapInfoGraphicsHeight überragt, muss der Platz für nachfolgende
   * Elemente (Kartenlink) auf dieser (größeren) Höhe basieren, nicht auf
   * mapInfoGraphicsHeight.
   */
  private readonly northArrowHeight = this.mapInfoGraphicsHeight * 2 + 1 / 2.54;

  /**
   * Breite (in Zoll) des Nordpfeils. War bisher quadratisch (= dem
   * Basiswert von northArrowHeight, also width === height, siehe
   * {@link _renderNorthArrow}); jetzt eigenständig, da Höhe und Breite auf
   * Wunsch unterschiedlich vergrößert wurden: Basiswert plus 0,5cm
   * (~0,1969in) zusätzliche Breite. Da das gerasterte Nordpfeil-Bild
   * quadratisch ist, wird es beim Zeichnen (addImage) leicht nicht-
   * uniform auf width × height gestreckt, statt unverzerrt zentriert zu
   * werden -- bei den hier gewählten, moderaten Maßen kaum wahrnehmbar,
   * aber technisch keine reine "mehr Rand"-Vergrößerung.
   */
  private readonly northArrowWidth = this.mapInfoGraphicsHeight * 2 + 0.5 / 2.54;

  /** The current layer for which a legend page is being added */
  currentLayerTitle?: string;

  /**
   * Calculates the positioning of the elements to be placed on the PDF.
   * @param pdfCreatorOptions The params for PDFCreator setup wrapped in an object.
   */
  async setup(pdfCreatorOptions: PDFCreatorOptions): Promise<void> {
    if (pdfCreatorOptions.format !== defaultOptions.formatDefault) {
      this.formatting = Object.assign(
        pageStyles.default,
        pageStyles[pdfCreatorOptions.format as keyof typeof pageStyles],
      );
    }
    if (
      pdfCreatorOptions.format !== defaultOptions.formatDefault ||
      pdfCreatorOptions.orientation !== defaultOptions.orientationDefault
    ) {
      const { format } = pdfCreatorOptions;
      this.pdfSize =
        pdfCreatorOptions.orientation === OrientationOptions.PORTRAIT
          ? { width: pageSizes[format][0], height: pageSizes[format][1] }
          : { width: pageSizes[format][1], height: pageSizes[format][0] };

      this.maxLineWidth =
        this.pdfSize.width -
        this.formatting.pageMargins[1] -
        this.formatting.pageMargins[3];

      /** the jsPDF instance for creating the PDF and adding content. */
      // eslint-disable-next-line new-cap
      this.pdfDoc = new jsPDF(
        pdfCreatorOptions.orientation,
        'in',
        pdfCreatorOptions.format,
      );
    }

    if (pdfCreatorOptions.fonts) {
      this.font = await this._addFonts(pdfCreatorOptions.fonts);
    }

    if (pdfCreatorOptions.orientation !== defaultOptions.orientationDefault) {
      this.orientation = pdfCreatorOptions.orientation;
    }

    if (pdfCreatorOptions.qrLink) {
      this.mapLink = pdfCreatorOptions.mapLink;
      this.qrCode = await QRCode.toDataURL(pdfCreatorOptions.qrLink, {
        margin: 0,
      });
      this.qrCodePlacement = this._calcQrCodePlacement();
    }

    // Logo VOR dem Titel berechnen: Kopfzeile ist konzeptionell eine
    // 3-Spalten-Tabelle (QR-Code / Titel / Logo). QR-Code und Logo haben
    // eine feste, von sich selbst abhängige Breite (Spalte 1 und 3); der
    // Titel (Spalte 2, flexibel) muss beide kennen, um seine verfügbare
    // Breite korrekt zu berechnen — ohne das würde ein langer Titel mit
    // dem rechts platzierten Logo kollidieren können.
    if (pdfCreatorOptions.logo) {
      this._setTextStyle('title');
      this.logo = pdfCreatorOptions.logo;
      this.logoPlacement = this._calcLogoPlacement(this.logo);
    }

    if (pdfCreatorOptions.title) {
      // Volle verfügbare Breite zwischen den Seitenrändern als
      // Ausgangspunkt (statt eines festen Bruchteils via
      // title.widthPortion) — die Titel-Spalte soll den gesamten Platz
      // zwischen QR-Code und Logo ausfüllen, nicht nur einen
      // konfigurierten Anteil davon.
      let width = this.maxLineWidth;
      let x = this.formatting.pageMargins[3];
      // Spalte 1 (QR-Code): schiebt die Titel-Spalte nach rechts und
      // verkleinert ihre Breite um genau den belegten Platz.
      if (this.qrCodePlacement) {
        x += this.qrCodePlacement.size.width + this.formatting.elementMargin;
        width -=
          this.qrCodePlacement.size.width + this.formatting.elementMargin;
      }
      // Spalte 3 (Logo): verkleinert die Titel-Spalte am rechten Ende um
      // genau den belegten Platz (x bleibt unverändert, nur die Breite
      // schrumpft, da das Logo rechtsbündig sitzt).
      if (this.logoPlacement) {
        width -= this.logoPlacement.size.width + this.formatting.elementMargin;
      }
      const maxLineCount =
        this.formatting[`title.maxLineCount.${this.orientation}`];

      this._setTextStyle('title');
      const titleArray: Array<string> = this.pdfDoc.splitTextToSize(
        pdfCreatorOptions.title,
        width,
      );
      this.title = titleArray.slice(0, maxLineCount);
      this.titlePlacement = this._calcTitlePlacement(
        this.title,
        width,
        maxLineCount,
        x,
      );
    }

    if (pdfCreatorOptions.scale) {
      pdfCreatorOptions.mapInfo?.text.push(pdfCreatorOptions.scale);
    }
    this.scaleDenominator = pdfCreatorOptions.scaleDenominator;
    this.northArrowRotation = pdfCreatorOptions.northArrowRotation;
    this.topRightCoordinate = pdfCreatorOptions.topRightCoordinate;
    this.bottomLeftCoordinate = pdfCreatorOptions.bottomLeftCoordinate;
    this.crsName = pdfCreatorOptions.crsName;
    this.northArrowImage = await this._renderNorthArrow(
      this.northArrowRotation ?? 0,
    );

    // Breite der Info-Spalten hängt nur von orientation/formatting ab, nicht
    // vom Inhalt — kann also vor der Höhenberechnung feststehen.
    this._setTextStyle('info');
    const infoWidth = this._calcElementWidth(
      this.formatting[`info.widthPortion.${this.orientation}`],
    );

    // Jede Zeile einzeln umbrechen (nicht den ganzen Block auf einmal),
    // damit z.B. Straße/PLZ/Ort weiterhin als eigene Zeilen erkennbar
    // bleiben und nur bei tatsächlicher Überlänge zusätzlich umbrechen.
    let wrappedContact: TextWithHeader | undefined;
    if (pdfCreatorOptions.contact) {
      console.log(pdfCreatorOptions.contact.header);
      console.log(pdfCreatorOptions.contact);
      console.log(pdfCreatorOptions);
      wrappedContact = {
        header: pdfCreatorOptions.contact.header,
        text: pdfCreatorOptions.contact.text.flatMap(
          (line) => this.pdfDoc.splitTextToSize(line, infoWidth) as string[],
        ),
      };
    }

    let wrappedMapInfo: TextWithHeader | undefined;
    if (pdfCreatorOptions.mapInfo) {
      wrappedMapInfo = {
        header: pdfCreatorOptions.mapInfo.header,
        text: pdfCreatorOptions.mapInfo.text.flatMap(
          (line) => this.pdfDoc.splitTextToSize(line, infoWidth) as string[],
        ),
      };
    }

    // Kontakt bestimmt die gemeinsame Kopf-Höhe ("ausgehend von Kontakt"):
    // beide Boxen beginnen oben auf derselben Höhe. Maßstabsbalken/Nordpfeil
    // und der Kartenlink hängen NICHT mehr in diese Referenzzeilenzahl mit
    // rein — sie werden beim Zeichnen direkt unterhalb des tatsächlichen
    // Karteninformation-Textes angehängt (siehe _calcMapInfoGraphicsRowY).
    // Ohne Kontakt fällt die Karteninformation auf ihre eigene Zeilenzahl
    // zurück.
    const contactLineCount = wrappedContact
      ? wrappedContact.text.length + 1
      : 0;
    const mapInfoLineCount = wrappedMapInfo
      ? wrappedMapInfo.text.length + 1
      : 0;
    const topReferenceLineCount = contactLineCount || mapInfoLineCount;

    if (wrappedContact) {
      this._setTextStyle('info');
      this.contact = wrappedContact;
      this.contactPlacement = this._calcContactPlacement(contactLineCount);
    }

    if (wrappedMapInfo) {
      this._setTextStyle('info');
      this.mapInfo = wrappedMapInfo;
      if (pdfCreatorOptions.mapLink) {
        this.mapLink = pdfCreatorOptions.mapLink;
      }
      this.mapInfoPlacement =
        this._calcMapInfoPlacement(topReferenceLineCount);
    }

    if (pdfCreatorOptions.description) {
      /** width of discription text field */
      let width = this.maxLineWidth;
      if (pdfCreatorOptions.orientation === OrientationOptions.LANDSCAPE) {
        if (this.contact && this.mapInfo) {
          // both info elems
          width *= 1 - 2 * this.formatting['info.widthPortion.landscape'];
        } else if (!this.contact !== !this.mapInfo) {
          // xor -> only one
          width *= 1 - this.formatting['info.widthPortion.landscape'];
        }
      }
      const maxLineCount =
        this.formatting[`description.maxLineCount.${this.orientation}`];

      this._setTextStyle('description');
      const descriptionArray: Array<string> = this.pdfDoc.splitTextToSize(
        pdfCreatorOptions.description,
        width,
      );
      this.description = descriptionArray.slice(0, maxLineCount);
      this.descriptionPlacement = this._calcDescriptionPlacement(
        this.description,
        width,
      );
    }

    // Kartenbereich: bei konfigurierter fester Größe (formatList[format][orientation])
    // wird diese exakt (zentriert, ohne Letterboxing) verwendet. Ohne
    // konfigurierte Größe bleibt die bisherige dynamische, seitenverhältnis-
    // erhaltende Berechnung als Fallback erhalten.
    this.imgPlacement = pdfCreatorOptions.imageSize
      ? this._calcFixedImagePlacement(pdfCreatorOptions.imageSize)
      : this._calcImagePlacement(pdfCreatorOptions.imgRatio);

    if (pdfCreatorOptions.copyright) {
      this._setTextStyle('info');
      this.copyright = pdfCreatorOptions.copyright;
      this.copyrightPlacement = this._calcCopyrightPlacement(
        pdfCreatorOptions.copyright,
      );
    }

    if (pdfCreatorOptions.legend) {
      this.legend = pdfCreatorOptions.legend;
    }

    this.initialized = true;
  }

  /**
   * Führt dieselbe Text-Layout-Berechnung wie {@link setup} aus (Titel,
   * Logo/QR-Kopfzeile, Kontakt, Karteninfo, Beschreibung), jedoch OHNE dass
   * bereits ein echtes Kartenbild vorliegen muss — `imgRatio`/`imageSize`
   * werden nicht benötigt. Reiner Passthrough: `title`/`description` werden
   * genauso behandelt wie in {@link setup} — bei kürzerem bzw. leerem Text
   * fällt die reservierte Höhe entsprechend kleiner aus. Für eine stabile,
   * vom aktuellen Textinhalt unabhängige Reservierung liegt es am Aufrufer,
   * stattdessen z.B. einen ausreichend langen Platzhaltertext zu übergeben.
   *
   * Gedacht für die UI: damit kann z.B. das Druckbereich-Rechteck bereits
   * VOR der eigentlichen Kartenabfrage seitenverhältnistreu zur wirklich
   * verfügbaren Fläche bemessen werden, statt sich nur an der rohen,
   * konfigurierten imageSize zu orientieren — die evtl. mit Beschreibung,
   * Kontakt oder Karteninfo kollidieren würde. Diese PDFCreator-Instanz darf
   * danach nicht mehr für {@link create} verwendet werden; dafür eine
   * separate, frische Instanz anlegen.
   * @param options Dieselben Optionen wie für {@link setup}, ohne
   * `imgRatio`/`imageSize`.
   * @returns Für den Kartenbereich verfügbare Größe in Inch.
   */
  public async calcAvailableImageSize(
    options: Omit<PDFCreatorOptions, 'imgRatio' | 'imageSize'>,
  ): Promise<Size> {
    await this.setup({
      ...options,
      // wird von _calcImageUpperBorder/_calcImageLowerBorder nicht
      // gelesen (nur für die Breiten/Höhen-Aufteilung INNERHALB der
      // damit ermittelten Kante) — hier daher ein reiner Platzhalter.
      imgRatio: 1,
    });
    return {
      width: this.maxLineWidth,
      height: this._calcImageLowerBorder() - this._calcImageUpperBorder(),
    };
  }

  /**
   * Sets text style globally on {@link jsPDF} instance of {@link PDFCreator}.
   * @param textElement Name of a text element with font size and style declared.
   * @example 'description'
   */
  private _setTextStyle(textElement: string): void {
    this.pdfDoc
      .setFont(
        this.font,
        'normal',
        this.formatting[
        `${textElement}.fontWeight` as keyof Omit<PageStyle, 'pageMargins'>
        ] || fontWeights.REGULAR,
      )
      .setFontSize(
        this.formatting[
        `${textElement}.fontSize` as keyof Omit<PageStyle, 'pageMargins'>
        ] || 11,
      )
      .setLineHeightFactor(
        this.formatting[
        `${textElement}.lineHeight` as keyof Omit<PageStyle, 'pageMargins'>
        ] || 1.15,
      );
  }

  /**
   * Calcs height of lines in inches with currently active text style.
   * @param numberLines Number of text lines
   * @returns The total height in inches
   */
  private _calcTotalLineHeight(numberLines: number): number {
    return (this.pdfDoc.getLineHeight() / JSPDF_PPI) * numberLines;
  }

  // TODO: works only if two elements are beside each other
  /**
   * Calcs width of element excluding margin.
   * @param portion of printable width (excluding page  margin and half element margin)
   * @returns The width of the element in inches.
   */
  private _calcElementWidth(portion: number): number {
    return this.maxLineWidth * portion - this.formatting.elementMargin / 2;
  }

  /**
   * Calcutlates placement of title. Position depends on page margins. Height does not depend on actual lines but on maxLineCount.
   * @param title The title.
   * @param width The width of the title text element.
   * @param maxLineCount max number of title lines.
   * @param x Optional x coordinate of the upper left corner. Defaults to the left page margin;
   * shifted to the right when a QR code is placed before the title.
   */
  private _calcTitlePlacement(
    title: string[],
    width: number,
    maxLineCount: number,
    x: number = this.formatting.pageMargins[3],
  ): ElementPlacement {
    return {
      coords: {
        x,
        // margin + half of the space that is added to font size by lineheight
        y:
          this.formatting.pageMargins[0] +
          this._calcTotalLineHeight(maxLineCount) / 2 -
          this._calcTotalLineHeight(title.length) / 2,
      },
      size: {
        width,
        // lower border depends only on maxLineCount, not on title line number
        height:
          this._calcTotalLineHeight(maxLineCount) / 2 +
          this._calcTotalLineHeight(title.length) / 2,
      },
    };
  }

  /**
   * Gemeinsame Bounding-Box-Größe für Logo und QR-Code in der Kopfzeile —
   * beide werden in dieselbe quadratische Fläche eingepasst, damit sie
   * unabhängig vom Seitenverhältnis des Logos wirklich gleich groß wirken
   * (siehe {@link _calcLogoPlacement}). Angestrebt wird etwas mehr als die
   * reine Titel-Zeilenhöhe (logo.scale), damit der QR-Code gut scannbar
   * bleibt — begrenzt aber auf die tatsächlich für die Kopfzeile
   * reservierte Höhe (title.maxLineCount der aktuellen Orientierung).
   * Ohne dieses Limit könnte das Icon über den oberen Seitenrand
   * hinausragen, da es bei der Y-Zentrierung auf diese Zeilenhöhe bezogen
   * wird (siehe _calcLogoPlacement/_calcQrCodePlacement).
   *
   * WICHTIG: setzt explizit den 'title'-Textstil, BEVOR Zeilenhöhen
   * berechnet werden. _calcTotalLineHeight() liest pdfDoc.getLineHeight(),
   * was vom AKTUELL AKTIVEN Textstil des jsPDF-Dokuments abhängt — ohne
   * dieses explizite Setzen würde das Ergebnis vom Aufrufzeitpunkt
   * abhängen: _calcQrCodePlacement() lief in setup() bisher VOR dem ersten
   * _setTextStyle('title')-Aufruf (jsPDF-Default-Schriftgröße, ~16pt),
   * _calcLogoPlacement() lief DANACH (korrekt 20pt/'title') — beide
   * lieferten dadurch unterschiedliche Ergebnisse, obwohl dieselbe Methode
   * aufgerufen wurde.
   */
  private _calcHeaderIconSize(): number {
    this._setTextStyle('title');

    const desired =
      this._calcTotalLineHeight(this.formatting['logo.scale']) * 5.1;

    const multiplier =
      this.orientation === OrientationOptions.LANDSCAPE
        ? 3
        : 1.2;

    const availableRowHeight =
      this._calcTotalLineHeight(
        this.formatting[`title.maxLineCount.${this.orientation}`],
      ) * multiplier;

    return Math.min(desired, availableRowHeight);
  }

  /**
   * Calcutlates placement of the logo. Position depends on page margins.
   * Das Logo wird in die von {@link _calcHeaderIconSize} vorgegebene
   * quadratische Fläche eingepasst (contain, Seitenverhältnis bleibt
   * erhalten) — bei einem breiten (Querformat-)Logo bestimmt also die
   * Breite die Verkleinerung, nicht mehr pauschal die Höhe. So wirkt das
   * Logo unabhängig von seinem Seitenverhältnis gleich groß wie der
   * (quadratische) QR-Code.
   * @param logo The logo.
   */
  private _calcLogoPlacement(logo: HTMLImageElement): ElementPlacement {
    const aspectRatio = logo.width / logo.height;
    const boundingSize = this._calcHeaderIconSize();
    const printWidth =
      aspectRatio >= 1 ? boundingSize : boundingSize * aspectRatio;
    const printHeight =
      aspectRatio >= 1 ? boundingSize / aspectRatio : boundingSize;
    return {
      coords: {
        x: this.pdfSize.width - this.formatting.pageMargins[3] - printWidth,
        y:
          this.formatting.pageMargins[0] +
          this._calcTotalLineHeight(
            this.formatting[`title.maxLineCount.${this.orientation}`],
          ) /
          2 -
          printHeight / 2,
      },
      size: {
        width: printWidth,
        height: printHeight,
      },
    };
  }

  /**
   * Calcutlates placement of the QR code linking to the map. Printed in the upper left
   * corner, directly before the title, vertically centered to the title's line height —
   * mirrors {@link _calcLogoPlacement}, just on the opposite side of the page.
   * Nutzt dieselbe Höhe wie das Logo ({@link _calcHeaderIconSize}), damit
   * beide in der Kopfzeile gleich groß wirken.
   */
  private _calcQrCodePlacement(): ElementPlacement {
    const printSize = this._calcHeaderIconSize();
    return {
      coords: {
        x: this.formatting.pageMargins[3],
        y:
          this.formatting.pageMargins[0] +
          this._calcTotalLineHeight(
            this.formatting[`title.maxLineCount.${this.orientation}`],
          ) /
          2 -
          printSize / 2,
      },
      size: {
        width: printSize,
        height: printSize,
      },
    };
  }

  /**
   * Calcutlates placement of the contact information. Position depends on page margins.
   * Height/y is based on a shared line count so contact, mapInfo and description all
   * start at the same height, regardless of which one has more actual content.
   * @param lineCount The shared line count to align contact, mapInfo and description to.
   */
  private _calcContactPlacement(lineCount: number): ElementPlacement {
    return {
      coords: {
        x: this.formatting.pageMargins[3],
        y:
          this.pdfSize.height -
          this.formatting.pageMargins[2] -
          this._calcTotalLineHeight(lineCount),
      },
      size: {
        width: this._calcElementWidth(
          this.formatting[`info.widthPortion.${this.orientation}`],
        ),
        height: this._calcTotalLineHeight(lineCount),
      },
    };
  }

  /**
   * Calcutlates placement of the map information. Position depends on page margins and
   * contact info availability. Height/y is based on a shared line count so contact,
   * mapInfo and description all start at the same height.
   * @param lineCount The shared line count to align contact, mapInfo and description to.
   */
  private _calcMapInfoPlacement(lineCount: number): ElementPlacement {
    const xMargin =
      this.orientation === OrientationOptions.PORTRAIT
        ? this.formatting.elementMargin
        : this.formatting.elementMargin / 2;

    // Oben auf derselben Höhe wie die Kontakt-Box (lineCount ist im
    // Regelfall die Kontakt-Zeilenzahl, "ausgehend von Kontakt").
    // Maßstabsbalken, Nordpfeil und Kartenlink werden separat direkt
    // unterhalb des tatsächlichen Textendes angehängt (siehe
    // _calcMapInfoGraphicsRowY, _drawScaleBar, create()) und beeinflussen
    // diese Platzierung bewusst nicht mehr.
    return {
      coords: {
        x: this.contact
          ? this.contactPlacement!.coords.x +
          this.contactPlacement!.size.width +
          xMargin
          : this.formatting.pageMargins[3],
        y:
          this.pdfSize.height -
          this.formatting.pageMargins[2] -
          this._calcTotalLineHeight(lineCount),
      },
      size: {
        width: this._calcElementWidth(
          this.formatting[`info.widthPortion.${this.orientation}`],
        ),
        height: this._calcTotalLineHeight(lineCount),
      },
    };
  }

  /**
   * Calcutlates placement of description. Position depends on page margins and position and height of title.
   * Height is textheight + bottom margin of description.
   * @param description The description.
   * @param width The width of the description text element.
   * @private
   */
  private _calcDescriptionPlacement(
    description: string[],
    width: number,
  ): ElementPlacement {
    let lowerBorder;
    let height;
    let x;
    if (this.orientation === OrientationOptions.PORTRAIT) {
      // An beiden nebeneinanderliegenden Info-Boxen ausrichten, nicht nur an
      // der zuerst vorhandenen — die höhere der beiden Boxen bestimmt, wo
      // die description enden muss, um eine Überlappung zu vermeiden.
      const infoBoxYs = [
        this.contactPlacement?.coords.y,
        this.mapInfoPlacement?.coords.y,
      ].filter((y): y is number => y !== undefined);
      lowerBorder = infoBoxYs.length
        ? Math.min(...infoBoxYs)
        : this.pdfSize.height - this.formatting.pageMargins[2];
      height =
        this._calcTotalLineHeight(description.length) +
        this.formatting.elementMargin;
      x = this.formatting.pageMargins[3];
    } else {
      lowerBorder = this.pdfSize.height - this.formatting.pageMargins[2];
      const infoBoxHeights = [
        this.contactPlacement?.size.height,
        this.mapInfoPlacement?.size.height,
      ].filter((h): h is number => h !== undefined);
      height = infoBoxHeights.length
        ? Math.max(...infoBoxHeights)
        : this._calcTotalLineHeight(description.length);
      x = this.pdfSize.width - this.formatting.pageMargins[1] - width;
    }
    return {
      coords: { x, y: lowerBorder - height },
      size: { width, height },
    };
  }

  /**
   * Berechnet die obere Kante des Kartenbereichs: direkt unterhalb von
   * Titel, Logo oder QR-Code (je nachdem, was vorhanden ist), sonst am
   * oberen Seitenrand. Wird sowohl von der dynamischen ({@link _calcImagePlacement})
   * als auch von der festen, konfigurierten Platzierung
   * ({@link _calcFixedImagePlacement}) des Kartenbereichs verwendet.
   * Der Abstand zum Bild ist bewusst nur halb so groß wie das sonst
   * übliche elementMargin (z.B. zwischen QR-Code/Logo und Titel), damit
   * die Kopfzeile enger an den Kartenbereich heranrückt.
   */
  private _calcImageUpperBorder(): number {
    const gapToImage = this.formatting.elementMargin / 2;
    // Bisher wurde nur EIN Element geprüft (Titel > Logo > QR-Code, erster
    // Treffer gewinnt) — bei gleichzeitigem Titel UND Logo/QR-Code wurde
    // die tatsächliche Höhe von Logo/QR-Code dadurch komplett ignoriert.
    // War die reservierte Titel-Zeile niedriger als das Logo/QR-Icon,
    // begann der Kartenbereich (und damit die direkt darüber gezeichnete
    // Eckkoordinate) zu früh und kollidierte mit dem noch laufenden
    // Logo/QR-Code. Jetzt: obere Kante = tiefste untere Kante aller
    // tatsächlich vorhandenen Kopfzeilen-Elemente.
    const candidates: number[] = [];
    if (this.title) {
      candidates.push(
        this.titlePlacement!.coords.y + this.titlePlacement!.size.height,
      );
    }
    if (this.logo) {
      candidates.push(
        this.logoPlacement!.coords.y + this.logoPlacement!.size.height,
      );
    }
    if (this.qrCodePlacement) {
      candidates.push(
        this.qrCodePlacement.coords.y + this.qrCodePlacement.size.height,
      );
    }
    if (!candidates.length) {
      return this.formatting.pageMargins[0];
    }
    return Math.max(...candidates) + gapToImage;
  }

  /**
   * Berechnet die untere Kante des Kartenbereichs: direkt oberhalb der
   * Beschreibung (falls vorhanden), sonst oberhalb der höheren der beiden
   * Info-Boxen (Kontakt/Karteninfo), sonst am unteren Seitenrand. Wird
   * sowohl von der dynamischen ({@link _calcImagePlacement}) als auch von
   * der festen, konfigurierten Platzierung ({@link _calcFixedImagePlacement})
   * verwendet, damit der Kartenbereich in beiden Fällen gleichermaßen vor
   * Beschreibung/Kontakt/Karteninfo zurückweicht, statt sie zu überlagern.
   */
  private _calcImageLowerBorder(): number {
    if (this.description) {
      return (
        this.descriptionPlacement!.coords.y - this.formatting.elementMargin
      );
    }
    // ohne description: an der höheren der beiden Info-Boxen ausrichten,
    // statt nur an der zuerst vorhandenen.
    const infoBoxYs = [
      this.contactPlacement?.coords.y,
      this.mapInfoPlacement?.coords.y,
    ].filter((y): y is number => y !== undefined);
    return infoBoxYs.length
      ? Math.min(...infoBoxYs) - this.formatting.elementMargin
      : this.formatting.pageMargins[2];
  }

  /**
   * Calculates the placement of the screenshot with max width and max height.
   * Position depends on page margins and position and height of title + description.
   * Max height and max width is the available space on the page. The image's
   * aspect ratio is preserved, which can leave white bars left/right or
   * top/bottom (letterboxing) when it doesn't match the available space's
   * aspect ratio. Used as a fallback when no `imageSize` is configured for
   * the selected format/orientation — see {@link _calcFixedImagePlacement}.
   * @param aspectRatio The aspect ratio of the image to be placed on the pdf.
   * @returns Placement of screenshot.
   */
  private _calcImagePlacement(aspectRatio: number): ElementPlacement {
    const upperBorder = this._calcImageUpperBorder();
    const lowerBorder = this._calcImageLowerBorder();
    // calc potential values by checking available space.
    let height = lowerBorder - upperBorder;
    let width = this.maxLineWidth;
    const potentialAspectRatio = width / height;
    let x = this.formatting.pageMargins[3];

    // compare with actual canvas aspect ratio to see which is the limiting factor.
    // Correct values accordingly.
    if (aspectRatio < potentialAspectRatio) {
      width = height * aspectRatio;
      x = this.pdfSize.width / 2 - width / 2;
    } else {
      height = width / aspectRatio;
    }

    return {
      coords: { x, y: upperBorder },
      size: { width, height },
    };
  }

  /**
   * Platziert den Kartenbereich linksbündig auf pageMargins[3] und immer
   * exakt `maxLineWidth` breit (statt der rohen Config-Breite zentriert) —
   * dadurch bündig mit Titel/Beschreibung/Kontakt-Infos (die ebenfalls auf
   * `maxLineWidth`/`pageMargins[3]` basieren) und mit dem rechtsbündigen
   * Logo (dessen rechte Kante ebenfalls bei `pdfSize.width - pageMargins[3]`
   * liegt). Das Seitenverhältnis aus der Config (`size.width / size.height`)
   * bleibt dabei erhalten — nur gleichmäßig auf die tatsächlich verfügbare
   * Breite hoch-/runterskaliert, damit keine Verzerrung gegenüber dem
   * zugeschnittenen Kartenausschnitt entsteht (dessen Seitenverhältnis exakt
   * denselben Config-Werten folgt, siehe Druckbereich-Rechteck in
   * PdfWindow.vue).
   * @param size Die konfigurierte Breite/Höhe des Kartenbereichs in Inch — hier nur als Quelle für das Seitenverhältnis genutzt, nicht als absolute Größe.
   */
  private _calcFixedImagePlacement(size: Size): ElementPlacement {
    const upperBorder = this._calcImageUpperBorder();
    const aspectRatio = size.width / size.height;
    const width = this.maxLineWidth;
    const height = width / aspectRatio;
    return {
      coords: { x: this.formatting.pageMargins[3], y: upperBorder },
      size: { width, height },
    };
  }

  private _calcCopyrightPlacement(copyright: string): ElementPlacement {
    this._setTextStyle('info');
    this.pdfDoc.setFontSize(6);
    const lines: string[] = this.pdfDoc.splitTextToSize(
      copyright,
      this.imgPlacement!.size.width,
    );
    const height = this._calcTotalLineHeight(lines.length);
    let width = 0;

    lines.forEach((line) => {
      const lineWidth = this.pdfDoc.getTextWidth(line);
      if (lineWidth > width) {
        width = lineWidth;
      }
    });

    const x =
      this.imgPlacement!.coords.x + this.imgPlacement!.size.width - width;
    const y =
      this.imgPlacement!.coords.y + this.imgPlacement!.size.height - height;
    return {
      coords: { x, y },
      size: { width, height },
    };
  }

  /**
   * Wählt aus der kartografisch üblichen 1/2/5×10^n-Folge (1, 2, 5, 10, 20,
   * 50, 100, ...) den größten Wert, der `maxMeters` nicht überschreitet —
   * damit der Maßstabsbalken eine "runde" Distanz zeigt statt eines
   * krummen Wertes.
   * @param maxMeters Obergrenze in Metern (z.B. abgeleitet aus der
   * gewünschten Balkenbreite und dem Maßstab).
   */
  private _pickNiceScaleBarDistance(maxMeters: number): number {
    if (!Number.isFinite(maxMeters) || maxMeters <= 0) {
      return 100;
    }
    const magnitude = 10 ** Math.floor(Math.log10(maxMeters));
    let best = magnitude;
    [1, 2, 5, 10].forEach((multiplier) => {
      const candidate = magnitude * multiplier;
      if (candidate <= maxMeters) {
        best = candidate;
      }
    });
    return best;
  }

  /**
   * Formatiert einen Distanzwert für die Maßstabsbalken-Beschriftung in der
   * übergebenen Zieleinheit (z.B. Rohwert in Metern -> "1.5" bei unit="km").
   * @param value Distanz in Metern.
   * @param unit Zieleinheit der Beschriftung ('m' oder 'km').
   */
  private _formatScaleDistance(value: number, unit: 'm' | 'km'): string {
    const displayValue = unit === 'km' ? value / 1000 : value;
    const rounded =
      unit === 'km'
        ? Math.round(displayValue * 10) / 10
        : Math.round(displayValue);
    return `${rounded}`;
  }

  /**
   * Y-Position (oberer Rand) der Grafikzeile (Maßstabsbalken + Nordpfeil)
   * innerhalb der Karteninformation-Box: direkt unterhalb der letzten
   * tatsächlich gezeichneten Textzeile (Header + Infozeilen, deren letzte
   * die Maßstabsbeschriftung ist) plus einem kleinen Abstand —
   * unabhängig von der (jetzt an Kontakt ausgerichteten) nominellen
   * Boxhöhe aus {@link _calcMapInfoPlacement}. So steht die
   * Maßstabsbeschriftung immer direkt über dem Balken, egal wie lang
   * Kontakt- und Karteninformation-Text jeweils sind.
   */
  private _calcMapInfoGraphicsRowY(): number {
    const textLineCount = this.mapInfo!.text.length + 1; // +1 Header
    return (
      this.mapInfoPlacement!.coords.y +
      this._calcTotalLineHeight(textLineCount) +
      this.mapInfoGraphicsGap
    );
  }

  /**
   * Zeichnet einen klassischen kartografischen Maßstabsbalken (alternierend
   * schwarz/weiß gefüllte Segmente mit sauberem Rahmen, Teilstrichen und
   * Beschriftung in einheitlicher Einheit) als Teil der Karteninformation-Box
   * (links neben dem Nordpfeil, siehe {@link _drawNorthArrow}) — ohne
   * eigenen Hintergrund, da die Box bereits auf weißem Seitengrund liegt.
   * Setzt `scaleDenominator` voraus (siehe {@link PDFCreatorOptions}) —
   * ohne diesen Wert und ohne Karteninformation-Box wird nichts gezeichnet.
   */
  private _drawScaleBar(): void {
    if (!this.mapInfoPlacement || !this.scaleDenominator || !this.mapInfo) {
      return;
    }

    const metersPerInch = this.scaleDenominator * 0.0254;

    // Grafikzeile der Karteninformation-Box: Maßstabsbalken links,
    // Nordpfeil rechts (siehe _drawNorthArrow) — direkt unterhalb der
    // letzten tatsächlich gezeichneten Textzeile (= Maßstabsbeschriftung),
    // damit sie unmittelbar über dem Balken steht (siehe
    // _calcMapInfoGraphicsRowY).
    const rowY = this._calcMapInfoGraphicsRowY();
    // Reservierter Platz für den Nordpfeil rechts vom Balken — entspricht
    // der tatsächlichen Breite des gerasterten Nordpfeils (siehe
    // _renderNorthArrow/_drawNorthArrow).
    const northArrowWidth = this.northArrowWidth;
    const northArrowGap = 0.08;

    // Platz für die Einheit-Beschriftung nach dem Balkenende einkalkulieren.
    const unitLabelReserve = 0.22;

    const maxWidthInches =
      this.mapInfoPlacement.size.width -
      northArrowWidth -
      northArrowGap -
      unitLabelReserve;

    const targetMeters = Math.max(maxWidthInches, 0.1) * metersPerInch;

    const scaleDistance = this._pickNiceScaleBarDistance(targetMeters);

    const barWidth = scaleDistance / metersPerInch;

    // Einheit einmal für den gesamten Balken bestimmen, damit alle
    // Teilstrich-Beschriftungen konsistent in derselben Einheit erscheinen.
    const unit: 'm' | 'km' = scaleDistance >= 1000 ? 'km' : 'm';

    const segments = 4;
    const segmentWidth = barWidth / segments;

    const barHeight = 0.07;
    const tickHeight = 0.03;
    const labelGap = 0.02;
    const lineWidth = 0.006;
    const barColor: [number, number, number] = [20, 20, 20];

    const x = this.mapInfoPlacement.coords.x;
    const y = rowY;

    /*
     * Balkensegmente (nur Flächenfüllung, kein Einzelrand je Segment –
     * der Rahmen wird separat als ein sauberer, einheitlicher Umriss
     * gezeichnet, damit an den Segmentgrenzen keine doppelten/unsauberen
     * Linien entstehen).
     */
    for (let i = 0; i < segments; i++) {
      const sx = x + i * segmentWidth;
      const isDark = i % 2 === 0;

      this.pdfDoc.setFillColor(
        isDark ? barColor[0] : 255,
        isDark ? barColor[1] : 255,
        isDark ? barColor[2] : 255,
      );

      this.pdfDoc.rect(sx, y, segmentWidth, barHeight, 'F');
    }

    /*
     * Einheitlicher Außenrahmen und Trennlinien zwischen den Segmenten
     */
    this.pdfDoc.setDrawColor(...barColor);
    this.pdfDoc.setLineWidth(lineWidth);

    this.pdfDoc.rect(x, y, barWidth, barHeight, 'D');

    for (let i = 1; i < segments; i++) {
      const sx = x + i * segmentWidth;
      this.pdfDoc.line(sx, y, sx, y + barHeight);
    }

    /*
     * Teilstriche unterhalb des Balkens
     */
    for (let i = 0; i <= segments; i++) {
      const sx = x + i * segmentWidth;
      this.pdfDoc.line(sx, y + barHeight, sx, y + barHeight + tickHeight);
    }

    /*
     * Beschriftung der Teilstriche (einheitliche Einheit für alle Werte)
     */
    this._setTextStyle('info');

    this.pdfDoc.setFontSize(6);
    this.pdfDoc.setTextColor(...barColor);

    for (let i = 0; i <= segments; i++) {
      const value = (scaleDistance / segments) * i;

      const label = this._formatScaleDistance(value, unit);

      this.pdfDoc.text(
        label,
        x + i * segmentWidth,
        y + barHeight + tickHeight + labelGap,
        {
          align: i === 0 ? 'left' : i === segments ? 'right' : 'center',
          baseline: 'top',
        },
      );
    }

    /*
     * Einheit rechts neben dem Balkenende
     */
    this.pdfDoc.text(
      unit,
      x + barWidth + 0.05,
      y + barHeight + tickHeight + labelGap,
      {
        baseline: 'top',
      },
    );

    // Zeichenzustand für nachfolgende Elemente zurücksetzen
    this.pdfDoc.setLineWidth(0.006);
  }

  /**
   * Rendert die NORTH_ARROW_SVG rotiert auf ein quadratisches Canvas und
   * gibt sie als PNG-Data-URL zurück. Das Canvas ist bewusst größer als
   * die Zielgröße (Diagonale als Seitenlänge), damit beim Rotieren um den
   * Mittelpunkt keine Ecken der Pfeilform abgeschnitten werden. Wird
   * einmalig in {@link setup} aufgerufen und das Ergebnis in
   * {@link northArrowImage} zwischengespeichert, damit {@link _drawNorthArrow}
   * beim eigentlichen Zeichnen nur noch ein fertiges Bild platzieren muss.
   * @param rotation Rotation im Bogenmaß, im Uhrzeigersinn (deckt sich mit northArrowRotation).
   * @param sizePx Zielgröße (Breite/Höhe) des Pfeils in Pixel vor der Rotation.
   */
  private async _renderNorthArrow(
    rotation: number,
    sizePx = 256,
  ): Promise<string> {
    const image = new Image();
    const svgBlob = new Blob([NORTH_ARROW_SVG], { type: 'image/svg+xml' });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = (): void => resolve();
        image.onerror = (): void =>
          reject(new Error('Failed to load north arrow SVG'));
        image.src = svgUrl;
      });

      // Canvas-Seitenlänge = Diagonale der Zielgröße, damit die rotierte
      // Form vollständig innerhalb des Canvas bleibt (kein Clipping).
      const canvasSize = Math.ceil(sizePx * Math.SQRT2);
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const ctx = canvas.getContext('2d')!;
      ctx.translate(canvasSize / 2, canvasSize / 2);
      ctx.rotate(rotation);
      ctx.drawImage(image, -sizePx / 2, -sizePx / 2, sizePx, sizePx);

      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  }

  /**
   * Platziert den vorgerenderten Nordpfeil ({@link northArrowImage},
   * bereits rotiert) unten rechts in der Karteninformation-Box: rechts
   * neben dem Maßstabsbalken, in derselben Grafikzeile (siehe
   * {@link _calcMapInfoGraphicsRowY}, {@link _drawScaleBar}).
   */
  private _drawNorthArrow(): void {
    if (!this.mapInfoPlacement || !this.northArrowImage) {
      return;
    }
  
    // 1. Höhe der Überschrift (1 Zeile) ermitteln
    const headerHeight = this._calcTotalLineHeight(1);
  
    // 2. Start-Y: Direkt unterhalb der Überschrift des Feldes
    const startY = this.mapInfoPlacement.coords.y + headerHeight;
  
    // 3. End-Y: Unterkante der Box (entspricht der Höhe des Nachbarfeldes)
    const boxBottomY = this.mapInfoPlacement.coords.y + this.mapInfoPlacement.size.height;
  
    // Optional: Falls der Pfeil unten nicht direkt den Rahmen berühren soll, 
    // kannst du hier einen kleinen Abstand (z. B. 2 mm) abziehen:
    const bottomPadding = 0; 
    const endY = boxBottomY - bottomPadding;
  
    // 4. Verfügbare Gesamthöhe für den Nordpfeil
    const arrowHeight = endY - startY;
  
    // 5. Proportionale Breite berechnen (Seitenverhältnis beibehalten)
    const aspectRatio = this.northArrowWidth / this.northArrowHeight;
    const arrowWidth = arrowHeight * aspectRatio;
  
    // 6. X-Position: Rechtsbündig an der rechten Box-Kante
    const x =
      this.mapInfoPlacement.coords.x +
      this.mapInfoPlacement.size.width -
      arrowWidth;
  
    // 7. Nordpfeil zeichnen
    this.pdfDoc.addImage(
      this.northArrowImage,
      'PNG',
      x,
      startY,
      arrowWidth,
      arrowHeight,
    );
  }

  /**
   * Formatiert einen Koordinatenwert fuer die Eckbeschriftung. Mit
   * withCrsName=true wird -- falls this.crsName gesetzt ist -- die
   * Projektionsbezeichnung in Klammern angehaengt (nur an den X-Werten
   * verwendet, um die Bezeichnung nicht an allen vier Werten zu
   * wiederholen).
   */
  private _formatCornerCoordinate(
    value: number,
    withCrsName = false,
  ): string {
    const formatted = value.toFixed(2);
    return withCrsName && this.crsName
      ? `${formatted} (${this.crsName})`
      : formatted;
  }

  /**
   * Zeichnet die Karten-Koordinaten der oberen rechten Ecke: Y horizontal
   * oberhalb der Karte (rechtsbuendig zur rechten Kartenkante), X senkrecht
   * (90° gedreht) rechts neben der Karte, oben an der Kartenkante
   * ausgerichtet.
   *
   * HINWEIS zur Leserichtung des Y-Werts: aktuell von oben nach unten
   * (angle: -90) -- laeuft damit neben der rechten Kartenkante nach unten.
   * Bevorzugt ihr stattdessen von unten nach oben lesend (uebliche
   * Konvention bei manchen Gitternetz-Beschriftungen), einfach auf
   * `angle: 90` aendern.
   */
  private _drawTopRightCoordinate(): void {
    if (!this.topRightCoordinate || !this.imgPlacement) {
      return;
    }
    this._setTextStyle('info');
    this.pdfDoc.setFontSize(7);

    const gap = 0.05;
    const rightEdge =
      this.imgPlacement.coords.x + this.imgPlacement.size.width;
    const topEdge = this.imgPlacement.coords.y;

    this.pdfDoc.text(
      this._formatCornerCoordinate(this.topRightCoordinate.y, true),
      rightEdge,
      topEdge - gap,
      { align: 'right', baseline: 'bottom' },
    );

    this.pdfDoc.text(
      this._formatCornerCoordinate(this.topRightCoordinate.x),
      rightEdge + gap,
      topEdge,
      { angle: -90, align: 'left', baseline: 'bottom' },
    );
  }

  /**
   * Zeichnet die Karten-Koordinaten der unteren linken Ecke: X horizontal
   * unterhalb der Karte (linksbuendig zur linken Kartenkante), Y senkrecht
   * links neben der Karte, von unten nach oben lesend (angle: 90), unten
   * an der Kartenkante ausgerichtet -- spiegelbildlich zu
   * _drawTopRightCoordinate.
   */
  private _drawBottomLeftCoordinate(): void {
    if (!this.bottomLeftCoordinate || !this.imgPlacement) {
      return;
    }
    this._setTextStyle('info');
    this.pdfDoc.setFontSize(7);

    const gap = 0.05;
    const leftEdge = this.imgPlacement.coords.x;
    const bottomEdge = this.imgPlacement.coords.y + this.imgPlacement.size.height;

    this.pdfDoc.text(
      this._formatCornerCoordinate(this.bottomLeftCoordinate.y, true),
      leftEdge,
      bottomEdge + gap,
      { align: 'left', baseline: 'top' },
    );

    this.pdfDoc.text(
      this._formatCornerCoordinate(this.bottomLeftCoordinate.x),
      leftEdge - gap,
      bottomEdge,
      { angle: 90, align: 'left', baseline: 'bottom' },
    );
  }

  /**
   * Adds a page to the PDF document, on which is added the title of the layer
   * whose legend entries are being added. Sets the text style to `info`.
   * @returns The title height.
   */
  private _addLegendPage(): number {
    this.pdfDoc.addPage(
      this.legend!.config.format,
      this.legend!.config.orientation,
    );
    this._setTextStyle('title');
    this.pdfDoc.setFontSize(12);
    const maxWidth =
      this.pdfSize.width -
      this.formatting.pageMargins[1] -
      this.formatting.pageMargins[3];
    this.pdfDoc.text(
      this.currentLayerTitle!,
      this.formatting.pageMargins[1],
      this.formatting.pageMargins[0],
      { baseline: 'top', maxWidth },
    );
    // Add legend items
    const titleHeight = this.pdfDoc.getTextDimensions(
      this.currentLayerTitle!,
    ).h;
    this._setTextStyle('info');
    return titleHeight;
  }

  /**
   * Creates a PDF file using the data from the init function as well as the input canvas. init() needs to be executed first.
   * @param canvas Canvas with screenshot of map.
   * @returns The created PDF as blob.
   */
  async create(
    canvas: HTMLCanvasElement,
    translate: (s: string) => string,
  ): Promise<Blob> {
    if (!this.initialized) {
      throw new Error(
        'pdfCreator instance needs first to be initialized by calling init method.',
      );
    }

    this.pdfDoc.addImage(
      canvas,
      'PNG',
      this.imgPlacement!.coords.x,
      this.imgPlacement!.coords.y,
      this.imgPlacement!.size.width,
      this.imgPlacement!.size.height,
    );

    this._drawTopRightCoordinate();
    this._drawBottomLeftCoordinate();

    if (this.title) {
      this._setTextStyle('title');
      this.pdfDoc.text(
        this.title,
        this.titlePlacement!.coords.x,
        this.titlePlacement!.coords.y,
        { baseline: 'top' },
      );
    }

    if (this.qrCode && this.qrCodePlacement) {
      this.pdfDoc.addImage(
        this.qrCode,
        this.qrCodePlacement.coords.x,
        this.qrCodePlacement.coords.y,
        this.qrCodePlacement.size.width,
        this.qrCodePlacement.size.height,
      );
    }

    if (this.copyright) {
      this._setTextStyle('info');
      this.pdfDoc.setFillColor(0, 0, 0, 0.1);
      this.pdfDoc.rect(
        this.copyrightPlacement!.coords.x,
        this.copyrightPlacement!.coords.y,
        this.copyrightPlacement!.size.width,
        this.copyrightPlacement!.size.height,
        'F',
      );
      this.pdfDoc.setFontSize(6);
      this.pdfDoc.text(
        this.pdfDoc.splitTextToSize(
          this.copyright,
          this.copyrightPlacement!.size.width,
        ),
        this.copyrightPlacement!.coords.x,
        this.copyrightPlacement!.coords.y,
        { baseline: 'top' },
      );
    }

    if (this.logo) {
      this.pdfDoc.addImage(
        this.logo,
        this.logoPlacement!.coords.x,
        this.logoPlacement!.coords.y,
        this.logoPlacement!.size.width,
        this.logoPlacement!.size.height,
      );
    }

    if (this.contact) {
      console.log("Kontakt: ", this.contact);
      this._setTextStyle('info');
      // -1 line height in y because of contact header
      this.pdfDoc.text(
        this.contact.text,
        this.contactPlacement!.coords.x,
        this.contactPlacement!.coords.y + this._calcTotalLineHeight(1),
        { baseline: 'hanging' },
      );
      this.pdfDoc.setFont(this.font, 'normal', fontWeights.BOLD);
      this.pdfDoc.text(
        this.contact.header,
        this.contactPlacement!.coords.x,
        this.contactPlacement!.coords.y,
        { baseline: 'hanging' },
      );
    }
    if (this.mapInfo) {
      this._setTextStyle('info');
      // -1 line height in y because of map info header
      this.pdfDoc.text(
        this.mapInfo.text,
        this.mapInfoPlacement!.coords.x,
        this.mapInfoPlacement!.coords.y + this._calcTotalLineHeight(1),
        { baseline: 'hanging' },
      );
      this.pdfDoc.setFont(this.font, 'normal', fontWeights.BOLD);
      this.pdfDoc.text(
        this.mapInfo.header,
        this.mapInfoPlacement!.coords.x,
        this.mapInfoPlacement!.coords.y,
        { baseline: 'hanging' },
      );

      // Maßstabsbalken und Nordpfeil als Grafikzeile direkt unterhalb des
      // tatsächlichen Textendes der Karteninformation-Box (siehe
      // _calcMapInfoGraphicsRowY).
      this._drawScaleBar();
      this._drawNorthArrow();

      // Kartenlink als unterste Information der Karteninformation-Box,
      // unterhalb von Maßstabsbalken und Nordpfeil.
      if (this.mapLink) {
        this._setTextStyle('info');
        let linkY =
          this._calcMapInfoGraphicsRowY() +
          this.northArrowHeight;

        if (this.contact && this.contactPlacement) {
          const contactBottom =
            this.contactPlacement.coords.y +
            this._calcTotalLineHeight(this.contact.text.length + 1);

          linkY = contactBottom - this._calcTotalLineHeight(1);
        }
        this.pdfDoc.textWithLink(
          translate('print.pdf.mapLinkText'),
          this.mapInfoPlacement!.coords.x,
          linkY,
          { baseline: 'hanging', url: this.mapLink },
        );
      }
    }

    if (this.description) {
      this._setTextStyle('description');
      this.pdfDoc.text(
        this.description,
        this.descriptionPlacement!.coords.x,
        this.descriptionPlacement!.coords.y,
        { baseline: 'hanging' },
      );
    }

    if (this.legend) {
      const { format, orientation } = this.legend.config;
      const isLandscape = orientation === LegendOrientationOptions.LANDSCAPE;
      const size: Size = isLandscape
        ? { width: pageSizes[format][1], height: pageSizes[format][0] }
        : { width: pageSizes[format][0], height: pageSizes[format][1] };

      const items = this.legend.items.filter((i) => !!i.legends.length);
      // eslint-disable-next-line @typescript-eslint/await-thenable
      for await (const legendEntry of items) {
        this.currentLayerTitle = legendEntry.title;
        const titleHeight = this._addLegendPage();
        const legendConfig = {
          size,
          useColumns: isLandscape && legendEntry.legends.length > 1,
          origin: {
            x: this.formatting.pageMargins[3],
            y:
              this.formatting.pageMargins[0] +
              titleHeight +
              this.formatting.elementMargin,
          },
        };
        await addLayerLegend(
          this.pdfDoc,
          this.formatting,
          legendEntry.legends,
          () => this._addLegendPage(),
          translate,
          legendConfig,
        );
      }
    }

    return Promise.resolve(this.pdfDoc.output('blob'));
  }

  /**
   * Adds font with regular and bold font weight to jsPdf document instance.
   * @param fonts
   * @returns name of font.
   */
  private async _addFonts(fonts: {
    name: string;
    bold: string;
    regular: string;
  }): Promise<string> {
    /**
     * Adds a custom font to the jsPDF instance.
     * @param name Name of font
     * @param fontPath Path to ttf file of font.
     * @param fontWeight Weight of font.
     * @param pdfDoc The pdfDoc instance.
     */
    async function addFont(
      name: string,
      fontPath: string,
      fontWeight: number,
      pdfDoc: jsPDF,
    ): Promise<void> {
      const font = await fetch(fontPath).then((response) => response.blob());
      const base64url: string = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (): void => {
          resolve(reader.result as string);
        };
        reader.readAsDataURL(font);
      });

      // removes text at beginning
      const base64String = base64url.split(',', 2)[1];

      pdfDoc.addFileToVFS(`${name}-${fontWeight}.ttf`, base64String);
      pdfDoc.addFont(`${name}-${fontWeight}.ttf`, name, 'normal', fontWeight);
    }

    await addFont(fonts.name, fonts.regular, fontWeights.REGULAR, this.pdfDoc);
    await addFont(fonts.name, fonts.bold, fontWeights.BOLD, this.pdfDoc);

    // Only one custom font is allowed so the name of the first is returned and therefore used.
    return fonts.name;
  }
}