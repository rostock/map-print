<template>
  <div>
    <v-overlay
      :model-value="running"
      contained
      persistent
      class="d-flex justify-center align-center"
    >
      <v-icon size="x-large" color="primary"> $vcsProgress </v-icon>
    </v-overlay>
    <v-container class="py-0 px-1">
      <v-row no-gutters>
        <v-col>
          <VcsLabel html-for="sizeSelect">
            {{ $t('print.pdf.format') }}
          </VcsLabel>
        </v-col>
        <v-col>
          <VcsSelect
            id="sizeSelect"
            v-model="state.selectedFormat"
            :items="config.formatList"
          />
        </v-col>
      </v-row>
      <v-row no-gutters>
        <v-col>
          <VcsLabel html-for="ppiSelect">
            {{ $t('print.pdf.resolution') }}
          </VcsLabel>
        </v-col>
        <v-col>
          <VcsSelect
            id="ppiSelect"
            v-model="state.selectedPpi"
            :items="
              config.ppiList.map((value: number) => {
                return { value, title: `${value} ppi` };
              })
            "
          />
        </v-col>
      </v-row>
      <v-row v-if="availableImageSizes.length > 1" no-gutters>
        <v-col>
          <VcsLabel html-for="imageSizeSelect">
            {{ $t('print.pdf.imageSize') }}
          </VcsLabel>
        </v-col>
        <v-col>
          <VcsSelect
            id="imageSizeSelect"
            v-model="state.selectedImageSize"
            :items="
              availableImageSizes.map((option) => {
                return { value: option.key, title: option.title || option.key };
              })
            "
          />
        </v-col>
      </v-row>
      <v-row v-if="is2DMap" no-gutters>
        <v-col>
          <VcsLabel html-for="printScaleInput">
            {{ $t('print.pdf.printScale') }}
          </VcsLabel>
        </v-col>
        <v-col>
          <VcsTextField
            id="printScaleInput"
            v-model.number="printScale"
            type="number"
            min="1"
            step="1"
            prefix="1:"
          />
        </v-col>
      </v-row>
      <v-row v-if="config.orientationOptions === 'both'" no-gutters>
        <VcsRadio
          v-model="state.selectedOrientation"
          mandatory
          inline
          :items="[
            { label: $t('print.pdf.portrait'), value: 'portrait' },
            { label: $t('print.pdf.landscape'), value: 'landscape' },
          ]"
        />
      </v-row>
    </v-container>
    <v-divider />
    <v-container class="py-0 px-1">
      <v-row no-gutters>
        <v-col>
          <VcsTextField
            v-if="config.allowTitle"
            v-model="state.title"
            :placeholder="$t('print.pdf.titlePlaceholder')"
          />
        </v-col>
      </v-row>
      <v-row no-gutters>
        <v-col>
          <VcsTextArea
            v-if="config.allowDescription"
            v-model="state.description"
            :placeholder="$t('print.pdf.descriptionPlaceholder')"
            :maxLength="config.charLimit"
            class="py-1"
            rows="2"
          />
          <div
            v-if="config.charLimit"
            class="text-caption text-right mt-1"
          >
            {{ state.description.length }} / {{ config.charLimit }}
          </div>
        </v-col>
      </v-row>
      <v-row v-if="enableLegendPrinting" no-gutters>
        <VcsCheckbox
          v-model="printLegend"
          :true-value="true"
          :false-value="false"
          label="print.pdf.printLegend"
        />
      </v-row>
      <v-row v-if="enableFeatureInfoPrinting" no-gutters>
        <VcsCheckbox
          v-model="printFeatureInfo"
          :true-value="true"
          :false-value="false"
          label="print.pdf.printFeatureInfo"
        />
      </v-row>
      <v-row v-if="enableLinkPrinting" no-gutters>
        <VcsCheckbox
          v-model="printLink"
          :true-value="true"
          :false-value="false"
          label="print.pdf.printLink"
        />
      </v-row>
      <v-row v-if="enableQrPrinting" no-gutters>
        <VcsCheckbox
          v-model="printQr"
          :true-value="true"
          :false-value="false"
          label="print.pdf.printQr"
        />
      </v-row>
      <v-row v-if="is2DMap" no-gutters class="mt-2">
        <v-col>
          <VcsLabel>
            {{ $t('print.pdf.scale', { scale: currentScale }) }}
          </VcsLabel>
        </v-col>
      </v-row>
    </v-container>
    <v-divider />
    <div class="d-flex w-full justify-end px-2 pt-2 pb-1">
      <VcsFormButton variant="filled" @click="createPdf">
        {{ $t('print.pdf.createButton') }}
      </VcsFormButton>
    </div>
  </div>
</template>

<script lang="ts">
  import {
    computed,
    defineComponent,
    inject,
    onUnmounted,
    ref,
    watch,
  } from 'vue';
  import { useI18n } from 'vue-i18n';
  import type { VcsUiApp } from '@vcmap/ui';
  import {
    downloadURI,
    getLegendEntries,
    getPluginAssetUrl,
    NotificationType,
    VcsCheckbox,
    VcsFormButton,
    VcsLabel,
    VcsRadio,
    VcsSelect,
    VcsTextArea,
    VcsTextField,
    getColorByKey, 
  } from '@vcmap/ui';
  import { OpenlayersMap, VectorLayer, WMSLayer, WMTSLayer } from '@vcmap/core';
  import {
    VCol,
    VDivider,
    VIcon,
    VContainer,
    VOverlay,
    VRow,
  } from 'vuetify/components';
  import { unByKey } from 'ol/Observable';
  import type { EventsKey } from 'ol/events';
  import Feature from 'ol/Feature';
  import type { FeatureLike } from 'ol/Feature';
  import Polygon from 'ol/geom/Polygon';
  import Point from 'ol/geom/Point';
  import PointerInteraction from 'ol/interaction/Pointer';
  import { Style, Stroke, Circle as CircleStyle, Fill } from 'ol/style';
  import type { Coordinate } from 'ol/coordinate';
  import type { Pixel } from 'ol/pixel';
  import type BaseLayer from 'ol/layer/Base';
  import type OLMap from 'ol/Map';
  import type MapBrowserEvent from 'ol/MapBrowserEvent';
  import { getLogger } from '@vcsuite/logger';
  import type { Extent } from 'ol/extent';
  import { transform } from 'ol/proj';
  import type { PrintPlugin } from '../index.js';
  import type { CanvasAndPlacement, Size } from './pdfCreator.js';
  import PDFCreator from './pdfCreator.js';
  import PrintCompositor from './printCompositor.js';
  import type { PrintLayer } from './printCompositor.js';
  import createAndHandleBlob from '../screenshot/shootScreenAndHandle.js';
  import {
    getLogo,
    formatContactInfo,
    getSwipeToolCanvas,
    getElementCanvas,
    getMapInfo,
    getCopyright,
    parseLegend,
    getMapLink,
  } from './pdfHelper.js';
  import {
    LegendOrientationOptions,
    OrientationOptions,
  } from '../common/configManager.js';
  import type { PrintUrlPattern } from '../common/configManager.js';
  import { getMapElement, getMapSize } from '../common/util.js';
  import { name } from '../../package.json';

  export const pdfWindowId = 'create_pdf_window_id';

  /** Layer name under which the print-area rectangle is registered. */
  const printAreaLayerName = 'print-area-rectangle-layer';

  /**
   * Fallback-Breite/Höhe des Druckbereich-Rechtecks in Karteneinheiten
   * (z.B. Meter bei projizierten Koordinatensystemen), falls für das
   * aktuell gewählte Format keine imageSize konfiguriert ist (siehe
   * computePrintAreaSize()).
   */
  const fallbackPrintAreaWidth = 500;
  const fallbackPrintAreaHeight = 350;

  /** Meter pro Inch — zur Umrechnung der konfigurierten imageSize (Inch) bei gegebenem Maßstab (1:x) in Karteneinheiten (angenommen: Meter). */
  const INCHES_TO_METERS = 0.0254;

  /**
   * Cursor über dem Rotationsgriff: EIN einzelner Rotations-Pfeil
   * (Kreisbogen + Pfeilspitze, kein Doppelpfeil/Sync-Icon) als
   * Daten-URI-SVG, mit "grab" als Fallback für Browser ohne
   * Custom-Cursor-Support. Derselbe Pfad wird zweimal gezeichnet: einmal
   * breiter in Schwarz (liegt darunter), einmal schmaler in Weiß (liegt
   * darüber) — der Überstand des Schwarzen an den Rändern ergibt einen
   * dünnen Rand um den dickeren, weißen Pfeil.
   */
  const rotateArrowPath = 'M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10';
  const rotateCursorSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
    `<path d="${rotateArrowPath}" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${rotateArrowPath}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    '</svg>';
  const rotateCursorStyle = `url("data:image/svg+xml,${encodeURIComponent(
    rotateCursorSvg,
  )}") 14 14, grab`;

  /** Cursor über dem Rechteck-Körper: vierseitiges Pfeilkreuz zum Verschieben. */
  const printAreaMoveCursorStyle = 'move';

  export default defineComponent({
    name: 'PdfWindow',
    components: {
      VcsCheckbox,
      VcsSelect,
      VcsTextField,
      VcsLabel,
      VcsFormButton,
      VcsTextArea,
      VcsRadio,
      VOverlay,
      VIcon,
      VContainer,
      VRow,
      VCol,
      VDivider,
    },
    setup() {
      const app = inject('vcsApp') as VcsUiApp;
      const plugin = app.plugins.getByKey(name) as PrintPlugin;
      const { config, state } = plugin;

      const { t } = useI18n();

      const { entries: legendEntries, destroy } = getLegendEntries(app);
      const enableLegendPrinting = computed(
        () => config.printLegend && !!legendEntries.length,
      );
      const printLegend = ref(true);

      const enableFeatureInfoPrinting = ref(
        config.printFeatureInfo && !!app.featureInfo.selectedFeature,
      );
      const featureInfoListener =
        app.featureInfo.featureChanged.addEventListener(() => {
          enableFeatureInfoPrinting.value = !!app.featureInfo.selectedFeature;
        });
      const printFeatureInfo = ref(true);

      const enableLinkPrinting = computed(() => !!config.printLinkToMap);
      const printLink = ref(true);

      const enableQrPrinting = computed(() => !!config.printQR);
      const printQr = ref(true);

      /** Kartenbereich-Größen-Varianten (config.imageSizeList), die zum aktuell gewählten Format passen. */
      const availableImageSizes = computed(() =>
        config.imageSizeList.filter(
          (option) => option.format === state.selectedFormat,
        ),
      );

      // Wenn das Format gewechselt wird und die bisher gewählte Größen-
      // Variante nicht mehr dazu passt, auf die erste passende Variante
      // zurücksetzen (bzw. undefined, falls keine existiert).
      watch(availableImageSizes, (options) => {
        if (!options.some((option) => option.key === state.selectedImageSize)) {
          state.selectedImageSize = options[0]?.key;
        }
      });

      /**
       * Die aktuell gewählte imageSize-Variante (config.imageSizeList),
       * gefiltert nach state.selectedImageSize bzw. als Fallback nach dem
       * ersten zu state.selectedFormat passenden Eintrag. Single Source of
       * Truth, sowohl für die PDF-Erstellung (createPdf) als auch für die
       * Größe des Druckbereich-Rechtecks (computePrintAreaSize).
       */
      const selectedImageSizeOption = computed(() =>
        config.imageSizeList.find(
          (option) =>
            option.key === state.selectedImageSize &&
            option.format === state.selectedFormat,
        ) ??
        config.imageSizeList.find(
          (option) => option.format === state.selectedFormat,
        ),
      );

      /** Kartenbereich-Größe (Inch) der aktuell gewählten Variante, orientierungsabhängig (mit Portrait/Landscape-Swap-Fallback). */
      const selectedImageSize = computed(() => {
        const option = selectedImageSizeOption.value;
        if (!option) {
          return undefined;
        }
        return state.selectedOrientation === OrientationOptions.PORTRAIT
          ? option.portrait
          : (option.landscape ?? {
              width: option.portrait.height,
              height: option.portrait.width,
            });
      });

      /**
       * Vom Nutzer frei eingebbarer Ziel-Druckmaßstab (Nenner, z.B. 1000 für
       * "1:1.000"). Bestimmt zusammen mit selectedImageSize die Größe des
       * Druckbereich-Rechtecks (rectState/bbox) — verändert dabei NICHT das
       * Zoomlevel/die Resolution der Live-Kartenansicht: das Druckbild wird
       * über PrintCompositor direkt aus BBox/Maßstab/Pixelgröße erzeugt
       * (siehe createPdf -> buildPrintLayers), die Live-Ansicht bleibt
       * währenddessen komplett unangetastet.
       */
      const printScale = ref<number>(1000);

      /** Berechnet die Rechteck-Größe (Karteneinheiten) aus selectedImageSize (Inch) und printScale (1:x). Fällt auf feste Werte zurück, falls keine imageSize-Variante passt oder die Maßstabs-Eingabe ungültig ist. */
      function computePrintAreaSize(): { width: number; height: number } {
        const imgSize = selectedImageSize.value;
        if (
          !imgSize ||
          !Number.isFinite(printScale.value) ||
          printScale.value <= 0
        ) {
          return {
            width: fallbackPrintAreaWidth,
            height: fallbackPrintAreaHeight,
          };
        }
        return {
          width: imgSize.width * INCHES_TO_METERS * printScale.value,
          height: imgSize.height * INCHES_TO_METERS * printScale.value,
        };
      }

      // State whether calculation is running.
      const running = ref(false);

      // --- Maßstab Logik ---
      const currentScale = ref<string>('');
      const is2DMap = ref(false);
      let resolutionListenerKey: EventsKey | null = null;

      /** Formatiert einen Maßstabsnenner (z.B. 1000 für "1:1.000") als "1:x"-Angabe. */
      function formatScaleDenominator(scaleDenominator: number): string {
        return `1:${Math.round(scaleDenominator).toLocaleString('de-DE')}`;
      }

      /** Liefert den aktuellen, numerischen Kartenmaßstab (Nenner) der aktiven 2D-Ansicht, oder undefined — Grundlage für den Maßstabsbalken im Fallback-Fall ohne Druckbereich-Rechteck. */
      function computeCurrentScaleDenominator(
        map: OpenlayersMap,
      ): number | undefined {
        const resolution = map.olMap.getView().getResolution();
        return resolution ? resolution * 39.37 * 96 : undefined;
      }

      const updateScale = (): void => {
        const activeMap = app.maps.activeMap;
        if (!(activeMap instanceof OpenlayersMap)) {
          return;
        }
        const resolution = activeMap.olMap.getView().getResolution();
        if (resolution) {
          currentScale.value = formatScaleDenominator(resolution * 39.37 * 96);
        }
      };

      function detachResolutionListener(): void {
        if (resolutionListenerKey) {
          unByKey(resolutionListenerKey);
          resolutionListenerKey = null;
        }
      }

      // --- Druckbereich-Rechteck Logik ---
      /** Property-Key, über den Rechteck- und Rotationsgriff-Feature unterschieden werden. */
      const printAreaRoleKey = 'printAreaRole';
      const printAreaRectangleRole = 'rectangle';
      const printAreaHandleRole = 'rotateHandle';

      /** Radius (Pixel), innerhalb dessen ein Klick auf den Rotationsgriff erkannt wird. */
      const rotateHandleHitRadius = 10;

      interface PrintAreaState {
        center: Coordinate;
        width: number;
        height: number;
        /** Rotation um das eigene Zentrum, in Radiant. */
        rotation: number;
      }

      /**
       * VectorLayer, der ausschließlich zur Anzeige von Rechteck und
       * Rotationsgriff dient, solange das Print-Fenster geöffnet ist. Wird
       * beim Öffnen angelegt und beim Schließen (onUnmounted) vollständig
       * wieder entfernt.
       */
      let printAreaLayer: VectorLayer | null = null;
      /** Karte, auf der die Interaction registriert wurde (für sauberes Entfernen). */
      let printAreaMap: OpenlayersMap | null = null;
      let printAreaInteraction: PointerInteraction | null = null;
      let printAreaPointerMoveKey: EventsKey | null = null;
      let printAreaState: PrintAreaState | null = null;
      let rectangleFeature: Feature | null = null;
      let handleFeature: Feature | null = null;
      /**
       * Aktueller Drag-Modus, während der Nutzer aktiv am Rechteck (Verschieben)
       * oder am Rotationsgriff (Rotieren) zieht — von handleDownEvent bis
       * handleUpEvent gesetzt. Bewusst außerhalb von createPrintAreaInteraction()
       * deklariert, damit auch der pointermove-Cursor-Listener
       * (createPrintAreaPointerMoveListener) währenddessen darauf zugreifen
       * kann: so bleibt der passende Cursor durchgehend sichtbar, auch wenn
       * der Zeiger den Rotationsgriff bei einer schnellen Drehung verlässt.
       */
      let printAreaDragMode: 'translate' | 'rotate' | null = null;

      /** Liefert die geschlossenen Eckpunkte des um state.rotation rotierten Rechtecks. */
      function getRectangleCoordinates(s: PrintAreaState): Coordinate[] {
        const halfWidth = s.width / 2;
        const halfHeight = s.height / 2;
        const corners: Coordinate[] = [
          [-halfWidth, -halfHeight],
          [halfWidth, -halfHeight],
          [halfWidth, halfHeight],
          [-halfWidth, halfHeight],
        ];
        const cos = Math.cos(s.rotation);
        const sin = Math.sin(s.rotation);
        const rotated = corners.map<Coordinate>(([x, y]) => [
          s.center[0] + x * cos - y * sin,
          s.center[1] + x * sin + y * cos,
        ]);
        return [...rotated, rotated[0]];
      }

      /** Liefert die Position des Rotationsgriffs (obere rechte Ecke, rotiert). */
      function getHandleCoordinate(s: PrintAreaState): Coordinate {
        const halfWidth = s.width / 2;
        const halfHeight = s.height / 2;
        const cos = Math.cos(s.rotation);
        const sin = Math.sin(s.rotation);
        return [
          s.center[0] + halfWidth * cos - halfHeight * sin,
          s.center[1] + halfWidth * sin + halfHeight * cos,
        ];
      }

      /** Aktualisiert beide Feature-Geometrien anhand von printAreaState. */
      function updatePrintAreaGeometries(): void {
        if (!printAreaState || !rectangleFeature || !handleFeature) {
          return;
        }
        (rectangleFeature.getGeometry() as Polygon).setCoordinates([
          getRectangleCoordinates(printAreaState),
        ]);
        (handleFeature.getGeometry() as Point).setCoordinates(
          getHandleCoordinate(printAreaState),
        );
      }

      /**
       * Passt die Größe des bereits vorhandenen Druckbereich-Rechtecks neu
       * an selectedImageSize/printScale an — Zentrum und Rotation bleiben
       * dabei unverändert erhalten (nur Größe, keine Neuerstellung). No-op,
       * solange kein Rechteck existiert (z.B. Print-Fenster geschlossen oder
       * 3D-/Oblique-Karte aktiv).
       */
      function resizePrintArea(): void {
        if (!printAreaState) {
          return;
        }
        const { width, height } = computePrintAreaSize();
        printAreaState.width = width;
        printAreaState.height = height;
        updatePrintAreaGeometries();
      }

      // Rechteck-Größe reaktiv an Maßstabs-Eingabe, Format, Orientierung und
      // gewählte Größen-Variante koppeln. Ändert dabei ausdrücklich NICHT
      // das Zoomlevel/die Resolution der Kartenansicht — nur die Größe des
      // Rechtecks selbst.
      watch(
        [
          printScale,
          () => state.selectedFormat,
          () => state.selectedOrientation,
          () => state.selectedImageSize,
        ],
        () => {
          resizePrintArea();
        },
      );

      /** Rotationsgriff: Füllung in Sekundärfarbe, weißer Rand. Rechteck: Umrandung in Primärfarbe. */
      function printAreaStyleFunction(feature: FeatureLike): Style {
        const primary = getColorByKey(app, 'primary');
        const secondary = getColorByKey(app, 'secondary');
        const background = getColorByKey(app, 'background');
        if (feature.get(printAreaRoleKey) === printAreaHandleRole) {
          return new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: secondary }),
              stroke: new Stroke({ color: background, width: 2 }),
            }),
          });
        }
        return new Style({
          fill: new Fill({ color: background + "80" }),
          stroke: new Stroke({
            color: primary,
            width: 2,
            
          }),
        });
      }

      /**
       * Erstellt Rechteck- und Rotationsgriff-Feature mit der aus
       * selectedImageSize + printScale berechneten Breite/Höhe (siehe
       * computePrintAreaSize()), zentriert auf den aktuellen Mittelpunkt der
       * 2D-Kartenansicht.
       */
      function createPrintAreaFeatures(map: OpenlayersMap): boolean {
        const center = map.olMap.getView().getCenter();
        if (!center) {
          return false;
        }

        const { width, height } = computePrintAreaSize();
        printAreaState = {
          center: [center[0], center[1]],
          width,
          height,
          rotation: 0,
        };

        rectangleFeature = new Feature({
          geometry: new Polygon([getRectangleCoordinates(printAreaState)]),
        });
        rectangleFeature.set(printAreaRoleKey, printAreaRectangleRole);

        handleFeature = new Feature({
          geometry: new Point(getHandleCoordinate(printAreaState)),
        });
        handleFeature.set(printAreaRoleKey, printAreaHandleRole);

        return true;
      }

      /** Prüft per Pixel-Distanz, ob sich der übergebene Pixel über dem Rotationsgriff befindet. */
      function isPixelOverHandle(map: OLMap, pixel: Pixel): boolean {
        if (!handleFeature) {
          return false;
        }
        const handleCoordinate = (
          handleFeature.getGeometry() as Point
        ).getCoordinates();
        const handlePixel = map.getPixelFromCoordinate(handleCoordinate);
        if (!handlePixel) {
          return false;
        }
        const dx = pixel[0] - handlePixel[0];
        const dy = pixel[1] - handlePixel[1];
        return Math.hypot(dx, dy) <= rotateHandleHitRadius;
      }

      /** Prüft, ob sich der übergebene Pixel über dem Rechteck-Körper befindet. */
      function isPixelOverRectangle(map: OLMap, pixel: Pixel): boolean {
        return !!map.forEachFeatureAtPixel(
          pixel,
          (feature) => feature.get(printAreaRoleKey) === printAreaRectangleRole,
          { hitTolerance: 4 },
        );
      }

      /**
       * Erstellt die Pointer-Interaction: Ziehen am Rotationsgriff dreht das
       * Rechteck um sein Zentrum, Ziehen am Rechteck selbst verschiebt es.
       * Der Drag-Modus wird in der äußeren Variable printAreaDragMode
       * gehalten (siehe dort), damit der Cursor-Listener während der
       * gesamten Drag-Dauer darauf zugreifen kann.
       */
      function createPrintAreaInteraction(): PointerInteraction {
        let dragStartCoordinate: Coordinate | null = null;
        let dragStartCenter: Coordinate | null = null;
        let baseHandleAngle = 0;

        return new PointerInteraction({
          handleDownEvent: (evt: MapBrowserEvent): boolean => {
            if (!printAreaState || !rectangleFeature || !handleFeature) {
              return false;
            }
            const { map } = evt;

            if (isPixelOverHandle(map, evt.pixel)) {
              printAreaDragMode = 'rotate';
              baseHandleAngle = Math.atan2(
                printAreaState.height / 2,
                printAreaState.width / 2,
              );
              return true;
            }

            if (isPixelOverRectangle(map, evt.pixel)) {
              printAreaDragMode = 'translate';
              dragStartCoordinate = evt.coordinate;
              dragStartCenter = [...printAreaState.center];
              return true;
            }

            return false;
          },
          handleDragEvent: (evt: MapBrowserEvent): void => {
            if (!printAreaState) {
              return;
            }
            if (printAreaDragMode === 'rotate') {
              const dx = evt.coordinate[0] - printAreaState.center[0];
              const dy = evt.coordinate[1] - printAreaState.center[1];
              printAreaState.rotation = Math.atan2(dy, dx) - baseHandleAngle;
              updatePrintAreaGeometries();
            } else if (
              printAreaDragMode === 'translate' &&
              dragStartCoordinate &&
              dragStartCenter
            ) {
              const dx = evt.coordinate[0] - dragStartCoordinate[0];
              const dy = evt.coordinate[1] - dragStartCoordinate[1];
              printAreaState.center = [
                dragStartCenter[0] + dx,
                dragStartCenter[1] + dy,
              ];
              updatePrintAreaGeometries();
            }
          },
          handleUpEvent: (): boolean => {
            printAreaDragMode = null;
            dragStartCoordinate = null;
            dragStartCenter = null;
            return false;
          },
        });
      }

      /**
       * Registriert einen pointermove-Listener, der den Karten-Cursor je nach
       * Hover-Ziel anpasst: Rotationsgriff -> rotateCursorStyle,
       * Rechteck-Körper -> printAreaMoveCursorStyle, sonst Standard-Cursor.
       * Während eines aktiven Drags (printAreaDragMode) bleibt der zum Modus
       * passende Cursor durchgehend gesetzt — unabhängig von der aktuellen
       * Zeiger-Position — damit er bei einer schnellen Rotation nicht
       * "flackert", sobald der Zeiger den Griff kurzzeitig verlässt.
       */
      function createPrintAreaPointerMoveListener(
        map: OpenlayersMap,
      ): EventsKey {
        return map.olMap.on('pointermove', (evt: MapBrowserEvent) => {
          if (!printAreaState) {
            return;
          }
          const target = map.olMap.getTargetElement();
          if (!target) {
            return;
          }
          if (printAreaDragMode === 'rotate') {
            target.style.cursor = rotateCursorStyle;
            return;
          }
          if (printAreaDragMode === 'translate') {
            target.style.cursor = printAreaMoveCursorStyle;
            return;
          }
          if (isPixelOverHandle(evt.map, evt.pixel)) {
            target.style.cursor = rotateCursorStyle;
          } else if (isPixelOverRectangle(evt.map, evt.pixel)) {
            target.style.cursor = printAreaMoveCursorStyle;
          } else {
            target.style.cursor = '';
          }
        });
      }

      /** Legt Rechteck-Layer inkl. Rotationsgriff und Drag-/Rotate-Interaction an (nur für 2D-Karten). */
      function addPrintAreaLayer(): void {
        const activeMap = app.maps.activeMap;
        if (!(activeMap instanceof OpenlayersMap)) {
          return;
        }
        if (!createPrintAreaFeatures(activeMap)) {
          return;
        }
        printAreaLayer = new VectorLayer({
          name: printAreaLayerName,
          projection: {
            epsg: activeMap.olMap.getView().getProjection().getCode(),
          }
        });
        printAreaLayer.setStyle(printAreaStyleFunction);

        printAreaLayer.addFeatures([rectangleFeature!, handleFeature!]);
        app.layers.add(printAreaLayer);
        printAreaLayer.activate().catch((error: unknown) => {
          getLogger(plugin.name).error(
            `Activating print-area layer failed: ${error as string}`,
          );
        });
        setTimeout(() => {}, 1000);
        printAreaMap = activeMap;
        printAreaInteraction = createPrintAreaInteraction();
        activeMap.olMap.addInteraction(printAreaInteraction);
        printAreaPointerMoveKey = createPrintAreaPointerMoveListener(activeMap);
      }

      /** Entfernt Rechteck-Layer, Features, Interaction und Cursor-Listener wieder vollständig. */
      function removePrintAreaLayer(): void {
        if (printAreaPointerMoveKey) {
          unByKey(printAreaPointerMoveKey);
          printAreaPointerMoveKey = null;
        }
        if (printAreaMap) {
          const target = printAreaMap.olMap.getTargetElement();
          if (target) {
            target.style.cursor = '';
          }
        }
        if (printAreaInteraction && printAreaMap) {
          printAreaMap.olMap.removeInteraction(printAreaInteraction);
        }
        printAreaInteraction = null;
        printAreaMap = null;
        printAreaDragMode = null;

        if (printAreaLayer) {
          app.layers.remove(printAreaLayer);
          printAreaLayer.destroy();
          printAreaLayer = null;
        }
        rectangleFeature = null;
        handleFeature = null;
        printAreaState = null;
      }

      function handleMapActivated(newMap: unknown): void {
        detachResolutionListener();
        is2DMap.value = newMap instanceof OpenlayersMap;
        if (is2DMap.value) {
          const map = newMap as OpenlayersMap;
          updateScale();
          resolutionListenerKey = map.olMap
            .getView()
            .on('change:resolution', updateScale);
        } else {
          currentScale.value = '';
        }
        // Rechteck neu anlegen, sobald zwischen 2D-/3D-Karte gewechselt wird,
        // solange das Print-Fenster geöffnet ist.
        removePrintAreaLayer();
        addPrintAreaLayer();
      }

      // einmalig für den initialen Zustand beim Öffnen des Windows,
      // da mapActivated nur zukünftige Wechsel meldet
      handleMapActivated(app.maps.activeMap);

      // meldet sich auch, während das Window bereits offen ist und die
      // Karte gewechselt wird (2D <-> 3D <-> Oblique <-> Panorama)
      const mapActivatedListener = app.maps.mapActivated.addEventListener(
        handleMapActivated,
      );
      // --- ENDE Maßstab / Druckbereich Logik ---

      /** Wartet auf den nächsten vollständigen Kartenrender-Durchlauf (nach View-Änderungen nötig, bevor ein Screenshot gemacht wird). */
      function waitForRenderComplete(map: OpenlayersMap): Promise<void> {
        return new Promise((resolve) => {
          map.olMap.once('rendercomplete', () => resolve());
          map.olMap.render();
        });
      }

      /**
       * Zerlegt eine vollstaendige WMS-GetMap-URL (inkl. Query-String) in
       * die Felder von WmsPrintLayer. SRS/CRS/BBOX/WIDTH/HEIGHT werden
       * bewusst NICHT uebernommen -- die setzt PrintCompositor bei jeder
       * Anfrage ohnehin frisch aus der tatsaechlichen Ziel-BBox/Projektion,
       * ein in der Config fest hinterlegter Wert waere hoechstens ein
       * Platzhalter. Alle uebrigen Parameter (z.B. TRANSPARENT, STYLES,
       * Vendor-Parameter) werden uebernommen und ueberschreiben beim
       * spaeteren GetMap-Aufruf die Defaults.
       */
      function parseWmsGetMapUrl(fullUrl: string): Omit<WmsPrintLayer, 'type'> {
        const parsed = new URL(fullUrl);
        const params: Record<string, string> = {};
        let layers = '';
        let version = '1.3.0';
        let format = 'image/png';
        const skip = new Set([
          'SERVICE',
          'REQUEST',
          'SRS',
          'CRS',
          'BBOX',
          'WIDTH',
          'HEIGHT',
        ]);
        parsed.searchParams.forEach((value, key) => {
          const upperKey = key.toUpperCase();
          if (upperKey === 'LAYERS') {
            layers = value;
          } else if (upperKey === 'VERSION') {
            version = value;
          } else if (upperKey === 'FORMAT') {
            format = value;
          } else if (!skip.has(upperKey)) {
            params[upperKey] = value;
          }
        });
        return {
          url: `${parsed.origin}${parsed.pathname}`,
          layers,
          version,
          format,
          params,
        };
      }

      /**
       * Prueft eine Liste von Kandidaten-URLs gegen config.pattern und
       * baut bei einem Treffer einen WmsPrintLayer -- damit landet der
       * Layer im selben, bereits vorhandenen WMS-Zweig wie echte
       * WMS-Layer, es entsteht kein separater Handler. Es zaehlt der
       * erste Treffer ueber alle Kandidaten-URLs hinweg.
       */
      // Zur Veranschaulichung: Das Interface für dein Pattern-Objekt sieht jetzt in etwa so aus:
// interface PrintUrlPattern {
//   name?: string;
//   pattern: string[]; // <-- Hier jetzt ein Array statt einem einzelnen String
//   replacement: string;
//   completeUrl?: boolean;
// }

function matchUrlPattern(urls: string[]): WmsPrintLayer | undefined {
  console.log("Pattern");
  console.log(config.pattern);
  const patterns = (config.pattern ?? []) as PrintUrlPattern[];

  for (const url of urls) {
    if (!url) {
      continue;
    }

    // 1. ANPASSUNG: Prüfe, ob ALLE Strings aus dem pattern-Array in der URL vorkommen
    const match = patterns.find((p) => 
      p.pattern.every((searchString) => url.includes(searchString))
    );

    if (match) {
      let replacedUrl = url;

      // 2. ANPASSUNG: Die Ersetzungslogik
      if (match.completeUrl) {
        // Die gesamte URL wird durch das Replacement ersetzt (wie in deiner Config gewünscht)
        replacedUrl = match.replacement;
      } else {
        // Falls completeUrl false ist: Wir gehen alle Strings im Array durch 
        // und ersetzen sie in der URL. 
        match.pattern.forEach((searchString) => {
          replacedUrl = replacedUrl.replace(searchString, match.replacement);
        });
      }

      return { type: 'wms', ...parseWmsGetMapUrl(replacedUrl) };
    }
  }
  return undefined;
}

      /**
       * Baut die für PrintCompositor benötigte Layer-Liste aus den aktiven
       * Layern der Karte, in Zeichenreihenfolge (zIndex). Der interne
       * Druckbereich-Rechteck-Hilfslayer (printAreaLayerName) wird
       * ausgeschlossen, da er nur eine UI-Hilfe ist, kein Karteninhalt.
       *
       * Reihenfolge pro Layer: 1) config.pattern-Treffer (schneller,
       * robusterer WMS-Weg fuer bekannte Dienste) -- 2) WMS -- 3) WMTS/
       * Vektor ueber Offscreen-Rendering als allgemeiner Fallback.
       *
       * Fuer den Pattern-Abgleich werden zwei Kandidaten-URLs gesammelt:
       * layer.url (funktioniert fuer WMS zuverlaessig) UND -- falls
       * vorhanden -- die tatsaechlichen Tile-URLs der zugrundeliegenden
       * OL-Quelle (source.getUrls()). Grund: bei REST-WMTS-Layern
       * (URL-Template mit Platzhaltern wie {TileMatrix}/{TileRow}/
       * {TileCol}) liegt die eigentliche URL haeufig NICHT in layer.url
       * (das waere dann leer), sondern nur in der OL-Quelle -- ein reiner
       * Abgleich gegen layer.url wuerde dort nie treffen.
       *
       * ACHTUNG: getImplementationsForMap(activeMap)/getOLLayer() sind
       * über die @vcmap/core-Doku bestätigt (LayerOpenlayersImpl-
       * Basisklasse); je nachdem, wie Messungen/Zeichnungen bei euch
       * verwaltet werden, muss dieser Zweig ggf. trotzdem angepasst
       * werden.
       */
      function buildPrintLayers(activeMap: OpenlayersMap): PrintLayer[] {
        return [...app.layers]
          .filter(
            (layer) => layer.active && layer.name !== printAreaLayerName,
          )
          .sort((a, b) => a.zIndex - b.zIndex)
          .flatMap((layer): PrintLayer[] => {
            const [impl] = layer.getImplementationsForMap?.(activeMap) ?? [];
            const olLayer = (
              impl as { getOLLayer?: () => BaseLayer } | undefined
            )?.getOLLayer?.();
            const source = (
              olLayer as { getSource?: () => unknown } | undefined
            )?.getSource?.();
            const sourceUrls =
              (
                source as { getUrls?: () => string[] | null } | undefined
              )?.getUrls?.() ?? [];
            const candidateUrls = [layer.url, ...sourceUrls];
            console.log(config);
            // TEMPORÄR zum Debuggen -- zeigt genau, wogegen der Pattern-
            // Abgleich fuer diesen Layer prueft.
            console.log('PrintCompositor candidateUrls', layer.name, candidateUrls);

            const patched = matchUrlPattern(candidateUrls);
            console.log(patched);
            if (patched) {
              return [patched];
            }
            if (layer instanceof WMSLayer) {
              console.log("Layer ist WMS");
              return [
                {
                  type: 'wms',
                  url: layer.url,
                  layers: layer.getLayers().join(','),
                  version: layer.version,
                  params: layer.parameters,
                },
              ];
            }
            // WMTS und Vektor-Layer haben beide bereits eine fertige
            // OL-Implementierung fuer die aktive Karte (LayerOpenlayersImpl
            // -- gemeinsame Basisklasse von WmtsOpenlayersImpl UND
            // VectorOpenlayersImpl -- stellt dafuer getOLLayer() bereit) --
            // werden daher beide ueber denselben Offscreen-Kartenmechanismus
            // in PrintCompositor gerendert statt ueber einen eigenen Abruf
            // wie bei WMS (WMTS braeuchte dafuer die komplette Tile-Matrix/
            // Kachelraster-Logik, die OL hier stattdessen selbst
            // uebernimmt). olLayer wurde oben schon fuer den
            // Pattern-Abgleich geholt, hier direkt weiterverwendet.
            if (layer instanceof WMTSLayer || layer instanceof VectorLayer) {
              return olLayer ? [{ type: 'vector', olLayer }] : [];
            }
            return [];
          });
      }

      /** Creates pdf by utilizing the PDFCreator. Handling is done by default function in shootScreenAndHandle.js */
      async function createPdf(): Promise<void> {
        running.value = true;
        const activeMap = app.maps.activeMap!;
        const mapElement = getMapElement(activeMap);
        const mapSize = getMapSize(activeMap);

        // Ziel-Pixelgroesse des Druckbereichs -- direkt aus dem gewaehlten
        // Papierformat/Orientierung (dieselbe Quelle wie
        // computePrintAreaSize(): selectedImageSize) und der gewaehlten
        // Druckaufloesung (PPI) abgeleitet. Bewusst UNABHAENGIG von der
        // aktuellen Fenster-/Kartenpanel-Groesse im Browser -- die Zoomstufe
        // ist damit direkt an den gewuenschten Maszstab gekoppelt.
        const targetImageSize = selectedImageSize.value;
        const targetPixelSize: Size | undefined = targetImageSize
          ? {
              width: targetImageSize.width * state.selectedPpi,
              height: targetImageSize.height * state.selectedPpi,
            }
          : undefined;

        const printAreaRotation = printAreaState?.rotation ?? 0;

        // Bei aktivem Druckbereich-Rechteck entspricht der gedruckte
        // Maßstab exakt printScale (die Rechteck-Größe wurde ja danach
        // berechnet) — ansonsten der bereits reaktiv gepflegte Maßstab der
        // vollen, unbeschnittenen Kartenansicht.
        const scale =
          is2DMap.value && (printAreaState || currentScale.value)
            ? t('print.pdf.scale', {
                scale: printAreaState
                  ? formatScaleDenominator(printScale.value)
                  : currentScale.value,
              })
            : undefined;

        // Numerischer Maßstab für den grafischen Maßstabsbalken — dieselbe
        // Quelle wie oben, nur unformatiert.
        const scaleDenominatorValue = printAreaState
          ? printScale.value
          : activeMap instanceof OpenlayersMap
            ? computeCurrentScaleDenominator(activeMap)
            : undefined;

        // Rotation für den Nordpfeil: dieselbe Rotation, mit der auch der
        // Kartenausschnitt bei PrintCompositor entdreht wird — mit
        // umgekehrtem Vorzeichen, siehe Herleitung im Kommentar von
        // PDFCreator._drawNorthArrow().
        const northArrowRotationValue =
          activeMap instanceof OpenlayersMap
            ? -printAreaRotation
            : 0;

        let logo;
        if (config.printLogo) {
          try {
            logo = await getLogo(app);
          } catch (error) {
            getLogger(plugin.name).error(
              `Fetching logo failed with following error: ${error as string}`,
            );
          }
        }

        /** contact information that can be defined in the plugin config and is printed in the lower left corner */
        let contact;
        if (
          config.contactDetails &&
          Object.keys(config.contactDetails).length
        ) {
          contact = formatContactInfo(app, config.contactDetails);
        }

        /** information about the map that is printed next to the contact information. Generated by mapHelper.js function. */
        let mapInfo;
        if (config.printMapInfo) {
          const { printObliqueName, printCoordinates, coordinatesProj } =
            config;
          mapInfo = await getMapInfo(
            app,
            printObliqueName,
            printCoordinates,
            coordinatesProj,
          );
        }

        /**
         * Link zur Karte wird nur einmal geholt, wenn mindestens einer von
         * Link-Text oder QR-Code sowohl in der Config aktiviert als auch
         * per Checkbox vom Nutzer ausgewählt ist.
         */
        let link;
        if (
          (config.printLinkToMap && printLink.value) ||
          (config.printQR && printQr.value)
        ) {
          link = await getMapLink(app);
        }
        let mapLink;
        if (config.printLinkToMap && printLink.value) {
          mapLink = link;
        }
        let qrLink;
        if (config.printQR && printQr.value) {
          qrLink = link;
        }

        /**
         * information about the copyright that is rendered in
         * the bottom right corner of the screenshot. Generated by mapHelper.js function.
         */
        let copyright;
        if (config.printCopyright) {
          copyright = getCopyright(app);
        }

        /**
         * Each legend entry is rendered on a new page at the end of the PDF. Generated by pdfHelper.ts.
         */
        let legend;
        if (enableLegendPrinting.value && printLegend.value) {
          const items = parseLegend(app, legendEntries);
          if (items?.length) {
            const format =
              !config.legendFormat || config.legendFormat === 'sameAsMap'
                ? state.selectedFormat
                : config.legendFormat;
            let orientation:
              | LegendOrientationOptions.LANDSCAPE
              | LegendOrientationOptions.PORTRAIT;
            if (
              config.legendOrientation &&
              config.legendOrientation !== LegendOrientationOptions.SAME_AS_MAP
            ) {
              orientation = config.legendOrientation;
            } else if (
              state.selectedOrientation === OrientationOptions.PORTRAIT
            ) {
              orientation = LegendOrientationOptions.PORTRAIT;
            } else {
              orientation = LegendOrientationOptions.LANDSCAPE;
            }
            const legendConfig = { format, orientation };
            legend = { items, config: legendConfig };
          }
        }

        /** The windows to be overprinted on the map. */
        const overlayWindows: CanvasAndPlacement[] = [];

        const swipeOverlay = await getSwipeToolCanvas(
          app,
          mapElement,
          state.selectedPpi,
        );
        if (swipeOverlay) {
          overlayWindows.push(swipeOverlay);
        }

        if (enableFeatureInfoPrinting.value && printFeatureInfo.value) {
          const featureInfo = await getElementCanvas(
            `window-component--${app.featureInfo.windowId!}`,
            mapElement,
            state.selectedPpi,
          );
          if (featureInfo) {
            overlayWindows.push(featureInfo);
          }
        }
        // could also be put into styles.js
        const fonts: { name: string; regular: string; bold: string } = {
          name: config.font?.name,
          regular: getPluginAssetUrl(
            app,
            name,
            config.font?.regular,
          )!,
          bold: getPluginAssetUrl(
            app,
            name,
            config.font?.bold,
          )!,
        };

        const mapAspectRatio = printAreaState
          ? printAreaState.width / printAreaState.height
          : mapSize.width / mapSize.height;

        // Feste, konfigurierte Kartenbereich-Größe für die gewählte Größen-
        // Variante — dieselbe Quelle (selectedImageSize), die auch die
        // Größe des Druckbereich-Rechtecks bestimmt (computePrintAreaSize).
        // Wenn vorhanden, füllt der Kartenbereich im PDF immer exakt diese
        // Größe aus (kein Letterboxing) — siehe PDFCreator._calcFixedImagePlacement.
        const imageSize = selectedImageSize.value;

        const pdfCreator = new PDFCreator();
        await pdfCreator
          .setup({
            orientation: state.selectedOrientation,
            format: state.selectedFormat,
            title: state.title,
            logo,
            imgRatio: mapAspectRatio,
            imageSize,
            description: state.description,
            contact,
            mapInfo,
            mapLink,
            qrLink,
            copyright,
            legend,
            fonts,
            scale,
            scaleDenominator: scaleDenominatorValue,
            northArrowRotation: northArrowRotationValue,
          })
          .then(async () => {
            // after setup possible to execute pdfCreator.create()
            const width =
              pdfCreator.imgPlacement!.size.width * state.selectedPpi;

            if (
              printAreaState &&
              activeMap instanceof OpenlayersMap &&
              targetPixelSize
            ) {
              // Druckbereich-Rechteck aktiv: Kartenbild wird direkt aus
              // WMS-GetMap-Anfragen und Vektor-Layern zusammengesetzt
              // (PrintCompositor) statt aus einem Live-Screenshot — die
              // Druckbereich-Rechteck-UI (printAreaLayer) muss dafür auch
              // nicht mehr aus-/eingeblendet werden, sie würde in einem
              // PrintCompositor-Bild ohnehin nie auftauchen.
              //
              // HINWEIS: overlayWindows (Swipe-Tool-/FeatureInfo-Overlays)
              // werden auf diesem Weg aktuell NICHT mit eingedruckt — deren
              // Positionierung basiert auf CSS-Pixel-Ratio-Koordinaten
              // relativ zum Live-Viewport, während PrintCompositor ein vom
              // Viewport unabhängiges Bild erzeugt. Müsste bei Bedarf
              // separat gelöst werden.
              // Live-Render-Projektion der Karte (z.B. EPSG:3857 /
              // Web-Mercator -- hat einen breitengradabhaengigen
              // Skalenfaktor von 1/cos(Breite), in Rostock ~1,7x). Ein
              // Screenshot dieser Ansicht traegt diese Verzerrung immer im
              // Bildinhalt mit sich -- printAreaState.width/height sind
              // zwar bereits echte, verzerrungsfreie Meterwerte (aus
              // printScale berechnet, siehe computePrintAreaSize), wuerden
              // aber als 3857-Koordinatendifferenz falsch interpretiert.
              const mapProjection = activeMap.olMap.getView().getProjection();

              // config.printEPSG (z.B. 'EPSG:25833', UTM) ist eine
              // weitgehend verzerrungsfreie Projektion, in der 1
              // Koordinateneinheit (nahezu) 1 echtem Meter entspricht --
              // dort koennen width/height direkt als Meter verwendet
              // werden. Nur das Zentrum muss dafuer reprojiziert werden;
              // Breite/Höhe bleiben unveraendert. Ohne konfiguriertes
              // printEPSG bleibt das bisherige Verhalten (Live-Projektion)
              // erhalten.
              // HINWEIS: die Rotation wird unveraendert uebernommen --
              // Web-Mercator hat ueberall exakt geografisch Nord als
              // "oben", UTM weicht davon je nach Lage zum Zonen-
              // Mittelmeridian um einen kleinen Betrag ab
              // (Meridiankonvergenz, für Rostock in EPSG:25833 im Bereich
              // von grob 1-2°) -- für die meisten Drucke vernachlässigbar,
              // aber nicht exakt null.
              const printProjection = config.printEPSG ?? mapProjection;
              const printCenter =
                config.printEPSG && config.printEPSG !== mapProjection.getCode()
                  ? transform(
                      printAreaState.center,
                      mapProjection,
                      config.printEPSG,
                    )
                  : printAreaState.center;

              const bbox: Extent = [
                printCenter[0] - printAreaState.width / 2,
                printCenter[1] - printAreaState.height / 2,
                printCenter[0] + printAreaState.width / 2,
                printCenter[1] + printAreaState.height / 2,
              ];
              const layers = buildPrintLayers(activeMap);

              const compositor = new PrintCompositor();
              const canvas = await compositor.compose(layers, {
                bbox,
                rotation: printAreaState.rotation,
                pixelSize: targetPixelSize,
                projection: printProjection,
                sourceProjection: mapProjection,
              });

              const blob = await pdfCreator.create(canvas, (s) =>
                app.vueI18n.t(s),
              );
              const url = URL.createObjectURL(blob);
              downloadURI(url, 'map.pdf');
              URL.revokeObjectURL(url);
            } else {
              // Kein Druckbereich-Rechteck aktiv (z.B. 3D-/Oblique-Karte,
              // oder Druck ohne definiertes Rechteck): bisheriger Weg über
              // einen Live-Screenshot der aktuell sichtbaren Kartenansicht.
              const createFn = async (
                canvas: HTMLCanvasElement,
                translate: (s: string) => string,
              ): Promise<Blob> => {
                printAreaLayer?.activate().catch((error: unknown) => {
                  getLogger(plugin.name).error(
                    `Reactivating print-area layer failed: ${error as string}`,
                  );
                });
                return pdfCreator.create(canvas, translate);
              };

              printAreaLayer?.deactivate();
              if (activeMap instanceof OpenlayersMap) {
                await waitForRenderComplete(activeMap);
              }

              await createAndHandleBlob(
                app,
                width,
                createFn,
                'map.pdf',
                overlayWindows,
              );
            }
          })
          .catch((e: unknown) => {
            app.notifier.add({
              type: NotificationType.ERROR,
              message: (e as Error).message,
            });
          })
          .finally(() => {
            // Sicherheitsnetz: falls der Druckvorgang nie richtig durchlief
            // (z.B. Fehler vor dem eigentlichen Rendern), Layer trotzdem
            // wieder einblenden. activate() auf einem bereits aktiven Layer
            // ist ungefährlich (No-Op).
            printAreaLayer?.activate().catch((error: unknown) => {
              getLogger(plugin.name).error(
                `Reactivating print-area layer failed: ${error as string}`,
              );
            });
            running.value = false;
          });
      }

      onUnmounted(() => {
        destroy();
        featureInfoListener();
        detachResolutionListener();
        mapActivatedListener();
        removePrintAreaLayer();
      });

      return {
        state,
        config,
        enableLegendPrinting,
        enableFeatureInfoPrinting,
        printFeatureInfo,
        printLegend,
        enableLinkPrinting,
        printLink,
        enableQrPrinting,
        printQr,
        availableImageSizes,
        printScale,
        running,
        createPdf,
        is2DMap,
        currentScale,
      };
    },
  });
</script>

<style lang="scss" scoped></style>