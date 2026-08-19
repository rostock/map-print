import Map from 'ol/Map.js';
import View from 'ol/View.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import { Style, Fill, Stroke, Circle as CircleStyle } from 'ol/style.js';
import { getCenter, getWidth, getHeight } from 'ol/extent.js';
import type { Extent } from 'ol/extent.js';
import type { ProjectionLike } from 'ol/proj.js';
import type BaseLayer from 'ol/layer/Base.js';
import type { StyleLike } from 'ol/style/Style.js';
import type Feature from 'ol/Feature.js';
import type { Size } from './pdfCreator.js';

/**
 * Baut das gedruckte Kartenbild direkt aus WMS-GetMap-Anfragen und
 * Vektor-Layern zusammen, statt einen Screenshot der aktuell im Browser
 * angezeigten Karte zu nutzen (renderScreenshot() aus @vcmap/core). Damit
 * ist das Ergebnis unabhaengig von der aktuellen Fenster-/Kartenpanel-
 * Groesse, von der genauen Extent-Semantik von renderScreenshot() und vom
 * gerade sichtbaren Kartenausschnitt ueberhaupt -- BBox, Massstab und
 * Pixelgroesse werden explizit vorgegeben, nicht aus der Live-Ansicht
 * gemessen.
 *
 * WMS-Layer werden per direktem fetch() auf eine selbst gebaute GetMap-URL
 * geladen -- keine OL-ImageWMS-Instanz noetig, da hier ohnehin eine
 * explizite BBox/Aufloesung/CRS vorliegt und nichts von einem bestehenden
 * Layer-Objekt "geerbt" werden muss. Vektor-Layer (Messungen, Zeichnungen)
 * laufen weiterhin ueber ein echtes, unsichtbares OL-Kartenobjekt, weil
 * dort tatsaechliches Rendering (Welt-zu-Pixel-Projektion + Styling
 * beliebiger Geometrien) noetig ist, kein reiner URL-Abruf.
 *
 * Rotation wird wie im bestehenden cropRotatedCanvasToPrintArea gehandhabt
 * (translate zur Zielmitte -> rotate(-rotation) -> translate zum
 * Rechteck-Mittelpunkt -> drawImage) -- der Mittelpunkt wird hier nur
 * direkt aus BBox/Resolution berechnet statt gemessen.
 */

/** Ein WMS-basierter Raster-Layer, abgerufen per direkter GetMap-Anfrage. */
export type WmsPrintLayer = {
  type: 'wms';
  url: string;
  /** WMS LAYERS-Parameter, kommagetrennt. */
  layers: string;
  version?: string; // default '1.3.0'
  format?: string; // default 'image/png'
  /** Weitere/ueberschreibende WMS-Parameter, z.B. STYLES. */
  params?: Record<string, string>;
};

/** Ein Vektor-Layer (z.B. Messungen, Zeichnungen), der clientseitig gerendert wird. */
export type VectorPrintLayer = {
  type: 'vector';
  olLayer?: BaseLayer;
  features?: Feature[];
  style?: StyleLike;
};

export type PrintLayer = WmsPrintLayer | VectorPrintLayer;

export type PrintOptions = {
  /** BBox des UNROTIERTEN Druckbereichs in Karteneinheiten: [minX, minY, maxX, maxY]. */
  bbox: Extent;
  /** Rotation des Druckbereichs, im Uhrzeigersinn, Bogenmass. 0 = keine Rotation. */
  rotation: number;
  /** Ziel-Pixelgroesse des fertigen (rotierten, zugeschnittenen) Kartenbereichs -- z.B. imageSize(Zoll) * selectedPpi. */
  pixelSize: Size;
  /** Ziel-Projektion des Druckbilds, z.B. 'EPSG:25833'. */
  projection: ProjectionLike;
  /**
   * Projektion, in der bereits vorhandene OL-Layer-Objekte (insbesondere
   * VectorPrintLayer.olLayer mit echten Feature-Geometrien) aktuell
   * vorliegen -- typischerweise die Live-Render-Projektion der Karte
   * (z.B. EPSG:3857). Nur relevant, wenn sie von `projection` abweicht:
   * OL reprojiziert Kachel-/Rasterquellen (auch WMTS) automatisch, wenn
   * die View-Projektion von der Quell-Projektion abweicht -- bei
   * Vektor-Quellen passiert das NICHT automatisch, die Feature-Geometrien
   * werden daher explizit transformiert (siehe _renderVectorLayer).
   */
  sourceProjection?: ProjectionLike;
};

/** Normalisiert ProjectionLike (String oder Projection-Objekt) auf den EPSG-Code-String, fuer Vergleiche. */
function getProjectionCode(projection: ProjectionLike): string {

  return typeof projection === 'string' ? projection : projection.getCode();
}

// --- JSON-Testdaten-Schema -------------------------------------------------
// WMS-Layer brauchen hier keinen eigenen Typ mehr -- WmsPrintLayer ist
// bereits reine, serialisierbare Daten (URL + Parameter), genau wie eine
// JSON-Datei sie liefern wuerde.

export type VectorLayerJson = {
  type: 'vector';
  /** GeoJSON FeatureCollection. Lose typisiert (object), um keine
   *  zusaetzliche @types/geojson-Abhaengigkeit vorauszusetzen. */
  geojson: object;
  /** Projektion des GeoJSON, falls abweichend von der Ziel-Projektion (z.B. 'EPSG:4326'). Default: dieselbe wie die Ziel-Projektion. */
  dataProjection?: string;
  style?: {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    pointRadius?: number;
  };
};

export type PrintCompositorTestData = {
  projection: string;
  bbox: Extent;
  rotation?: number;
  pixelSize: Size;
  layers: (WmsPrintLayer | VectorLayerJson)[];
};

export default class PrintCompositor {
  /**
   * Baut das Kartenbild Schicht fuer Schicht zusammen (in der gegebenen
   * Reihenfolge, unterster Layer zuerst) und liefert ein fertiges, bereits
   * auf pixelSize zugeschnittenes und rotiertes Canvas zurueck -- kann
   * direkt als `canvas`-Argument an pdfCreator.create(canvas, translate)
   * uebergeben werden (setup() muss vorher trotzdem gelaufen sein, fuer
   * Titel/Legende/Platzierung).
   * @param layers Aktive Layer und Feature-Gruppen in Zeichenreihenfolge.
   * @param options BBox, Rotation, Ziel-Pixelgroesse und Projektion.
   */
  async compose(
    layers: PrintLayer[],
    options: PrintOptions,
  ): Promise<HTMLCanvasElement> {
    const { bbox, rotation, pixelSize, projection, sourceProjection } =
      options;

    const resolution = getWidth(bbox) / pixelSize.width;

    const sourceBBox = rotation
      ? this._computeRotatedBoundingBox(bbox, rotation)
      : bbox;
    const sourcePixelSize: Size = {
      width: Math.round(getWidth(sourceBBox) / resolution),
      height: Math.round(getHeight(sourceBBox) / resolution),
    };

    const composite = document.createElement('canvas');
    composite.width = sourcePixelSize.width;
    composite.height = sourcePixelSize.height;
    const ctx = composite.getContext('2d')!;

    for (const layer of layers) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const layerCanvas =
          layer.type === 'wms'
            ? await this._fetchWmsLayerImage(
                layer,
                sourceBBox,
                sourcePixelSize,
                projection,
              )
            : await this._renderVectorLayer(
                layer,
                sourceBBox,
                resolution,
                sourcePixelSize,
                projection,
                sourceProjection,
              );
        if (layerCanvas) {
          ctx.drawImage(
            layerCanvas as CanvasImageSource,
            0,
            0,
            sourcePixelSize.width,
            sourcePixelSize.height,
          );
        }
      } catch (error) {
        // Ein einzelner fehlerhafter Layer (z.B. WMS nicht erreichbar) soll
        // nicht den gesamten Druck verhindern -- Fehler loggen, mit den
        // uebrigen Layern weitermachen. Besonders relevant beim Testen mit
        // Dummy-Daten, wenn noch nicht alle URLs echt/erreichbar sind.
        // eslint-disable-next-line no-console
        console.error(
          `PrintCompositor: Layer (${layer.type}) konnte nicht gerendert werden.`,
          error,
        );
      }
    }

    if (!rotation) {
      return composite;
    }
    return this._rotateAndCrop(
      composite,
      sourceBBox,
      bbox,
      rotation,
      resolution,
      pixelSize,
    );
  }

  /**
   * Adapter fuer Test-/Dummy-Daten: nimmt eine reine JSON-Struktur (WMS als
   * URL+Parameter, Vektor-Layer als GeoJSON) entgegen und liefert das
   * fertige Canvas zurueck. WMS-Layer werden unveraendert durchgereicht
   * (WmsPrintLayer ist bereits das JSON-Format); Vektor-Layer werden aus
   * GeoJSON zu einem OL-Layer aufgebaut. Gedacht, um die Klasse
   * eigenstaendig zu testen, bevor sie an app.layers angebunden wird.
   */
  async composeFromJson(
    data: PrintCompositorTestData,
  ): Promise<HTMLCanvasElement> {
    const layers: PrintLayer[] = data.layers.map((layerJson) =>
      layerJson.type === 'wms'
        ? layerJson
        : {
            type: 'vector',
            olLayer: this._buildVectorLayerFromJson(
              layerJson,
              data.projection,
            ),
          },
    );

    return this.compose(layers, {
      bbox: data.bbox,
      rotation: data.rotation ?? 0,
      pixelSize: data.pixelSize,
      projection: data.projection,
    });
  }

  private _buildVectorLayerFromJson(
    config: VectorLayerJson,
    projection: ProjectionLike,
  ): BaseLayer {
    const features = new GeoJSON().readFeatures(config.geojson, {
      dataProjection: config.dataProjection ?? projection,
      featureProjection: projection,
    });
    return new VectorLayer({
      source: new VectorSource({ features }),
      style: this._buildStyleFromJson(config.style),
    });
  }

  private _buildStyleFromJson(style?: VectorLayerJson['style']): Style {
    const fillColor = style?.fill ?? 'rgba(255,0,0,0.25)';
    const strokeColor = style?.stroke ?? '#ff0000';
    const strokeWidth = style?.strokeWidth ?? 2;
    return new Style({
      fill: new Fill({ color: fillColor }),
      stroke: new Stroke({ color: strokeColor, width: strokeWidth }),
      image: new CircleStyle({
        radius: style?.pointRadius ?? 5,
        fill: new Fill({ color: fillColor }),
        stroke: new Stroke({ color: strokeColor, width: strokeWidth }),
      }),
    });
  }

  /**
   * Baut die GetMap-URL direkt und laedt sie per fetch() -- keine
   * OL-ImageWMS-Instanz noetig. Einzige wirklich versionsabhaengige
   * Kleinigkeit: WMS 1.3.0 nennt den Projektions-Parameter CRS, 1.1.1
   * nennt ihn SRS. Die BBOX-Achsreihenfolge wird hier immer als
   * minX,minY,maxX,maxY (easting/northing) gebaut -- korrekt fuer
   * projizierte CRS wie EPSG:25832/25833. Bei geografischen CRS (z.B.
   * EPSG:4326) UND WMS 1.3.0 kann die offizielle Achsreihenfolge davon
   * abweichen (lat,lon statt lon,lat) -- falls ihr solche Layer je
   * einbindet, muesste das hier zusaetzlich beruecksichtigt werden.
   */
  private async _fetchWmsLayerImage(
    layer: WmsPrintLayer,
    bbox: Extent,
    pixelSize: Size,
    projection: ProjectionLike,
  ): Promise<HTMLImageElement> {
    const version = layer.version ?? '1.3.0';
    const crsParam = version === '1.1.1' ? 'SRS' : 'CRS';
    const crsCode =
      typeof projection === 'string' ? projection : projection.getCode();

    const params = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      VERSION: version,
      LAYERS: layer.layers,
      [crsParam]: crsCode,
      BBOX: bbox.join(','),
      WIDTH: String(pixelSize.width),
      HEIGHT: String(pixelSize.height),
      FORMAT: layer.format ?? 'image/png',
      TRANSPARENT: 'true',
      STYLES: 'default',
      ...layer.params,
    });
    const separator = layer.url.includes('?') ? '&' : '?';
    const url = `${layer.url}${separator}${params.toString()}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `WMS-Anfrage fehlgeschlagen (${response.status} ${response.statusText}): ${url}`,
      );
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  /**
   * Rendert einen Vektor-Layer auf ein temporaeres, unsichtbares
   * OL-Kartenobjekt mit exakt vorgegebener BBox/Aufloesung/Pixelgroesse --
   * OL uebernimmt dabei die komplette Welt-zu-Pixel-Projektion und das
   * Styling selbst. Das ist der Grund, warum dieser Pfad (anders als WMS)
   * bei OL bleibt: beliebige Geometrien/Styles korrekt zu rendern ist ein
   * echtes Rendering-Problem, kein reiner URL-Abruf.
   *
   * Falls die Feature-Geometrien in einer anderen Projektion vorliegen als
   * die Ziel-`projection` (sourceProjection gesetzt und abweichend), werden
   * sie vorher explizit umprojiziert -- OL macht das bei echten
   * Vektor-Quellen NICHT automatisch (anders als bei WMTS/Kachelquellen).
   * Die Original-Features (der Live-Karte) werden dabei nicht veraendert,
   * es wird jeweils ein geklonter Layer mit geklonten Features verwendet.
   */
  private async _renderVectorLayer(
    layer: VectorPrintLayer,
    bbox: Extent,
    resolution: number,
    pixelSize: Size,
    projection: ProjectionLike,
    sourceProjection?: ProjectionLike,
  ): Promise<HTMLCanvasElement> {
    let olLayer =
      layer.olLayer ??
      new VectorLayer({
        source: new VectorSource({ features: layer.features ?? [] }),
        style: layer.style,
      });

    const source = olLayer.getSource?.();
    if (
      sourceProjection &&
      source instanceof VectorSource &&
      getProjectionCode(sourceProjection) !== getProjectionCode(projection)
    ) {
      const reprojectedFeatures = source.getFeatures().map((feature) => {
        const clone = feature.clone();
        clone.getGeometry()?.transform(sourceProjection, projection);
        return clone;
      });
      olLayer = new VectorLayer({
        source: new VectorSource({ features: reprojectedFeatures }),
        // Pragmatischer Cast: der Laufzeit-Check oben (source instanceof
        // VectorSource) stellt praktisch sicher, dass olLayer hier ein
        // VectorLayer ist, auch wenn der Typ allgemein BaseLayer ist.
        style:
          (olLayer as VectorLayer<VectorSource>).getStyle?.() ?? layer.style,
      });
    }

    const target = document.createElement('div');
    target.style.position = 'fixed';
    target.style.left = '-99999px';
    target.style.top = '0';
    target.style.width = `${pixelSize.width}px`;
    target.style.height = `${pixelSize.height}px`;
    document.body.appendChild(target);

    const offscreenMap = new Map({
      target,
      view: new View({
        projection,
        center: getCenter(bbox),
        resolution,
        rotation: 0, // Rotation wird erst beim finalen Zuschnitt angewandt
      }),
      layers: [olLayer],
      controls: [],
      interactions: [],
    });
    offscreenMap.setSize([pixelSize.width, pixelSize.height]);

    await new Promise<void>((resolve) => {
      offscreenMap.once('rendercomplete', () => resolve());
    });

    const sourceCanvas = target.querySelector('canvas') as HTMLCanvasElement;
    const result = document.createElement('canvas');
    result.width = pixelSize.width;
    result.height = pixelSize.height;
    if (sourceCanvas) {
      result.getContext('2d')!.drawImage(sourceCanvas, 0, 0);
    }

    offscreenMap.setTarget(undefined);
    document.body.removeChild(target);
    return result;
  }

  /** Achsenparallele Bounding Box, die das um `rotation` gedrehte bbox-Rechteck vollstaendig umschliesst. */
  private _computeRotatedBoundingBox(bbox: Extent, rotation: number): Extent {
    const center = getCenter(bbox);
    const halfWidth = getWidth(bbox) / 2;
    const halfHeight = getHeight(bbox) / 2;
    const cos = Math.abs(Math.cos(rotation));
    const sin = Math.abs(Math.sin(rotation));
    const rotatedHalfWidth = halfWidth * cos + halfHeight * sin;
    const rotatedHalfHeight = halfWidth * sin + halfHeight * cos;
    return [
      center[0] - rotatedHalfWidth,
      center[1] - rotatedHalfHeight,
      center[0] + rotatedHalfWidth,
      center[1] + rotatedHalfHeight,
    ];
  }

  /**
   * Dreht das unrotierte Verbund-Canvas um `-rotation` und schneidet exakt
   * auf `targetBBox`/`targetPixelSize` zu. Selbes Muster wie im
   * bestehenden cropRotatedCanvasToPrintArea.
   */
  private _rotateAndCrop(
    source: HTMLCanvasElement,
    sourceBBox: Extent,
    targetBBox: Extent,
    rotation: number,
    resolution: number,
    targetPixelSize: Size,
  ): HTMLCanvasElement {
    const result = document.createElement('canvas');
    result.width = targetPixelSize.width;
    result.height = targetPixelSize.height;
    const ctx = result.getContext('2d')!;

    const targetCenter = getCenter(targetBBox);
    const centerPx = {
      x: (targetCenter[0] - sourceBBox[0]) / resolution,
      y: (sourceBBox[3] - targetCenter[1]) / resolution,
    };

    ctx.save();
    ctx.translate(targetPixelSize.width / 2, targetPixelSize.height / 2);
    ctx.rotate(-rotation);
    ctx.translate(-centerPx.x, -centerPx.y);
    ctx.drawImage(source, 0, 0);
    ctx.restore();

    return result;
  }
}