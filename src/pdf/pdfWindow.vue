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
  import { useTheme } from 'vuetify';
  import type { VcsUiApp } from '@vcmap/ui';
  import {
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
  } from '@vcmap/ui';
  import { OpenlayersMap, VectorLayer } from '@vcmap/core';
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
  import type OLMap from 'ol/Map';
  import type MapBrowserEvent from 'ol/MapBrowserEvent';
  import { getLogger } from '@vcsuite/logger';
  import type { PrintPlugin } from '../index.js';
  import type { CanvasAndPlacement, Size } from './pdfCreator.js';
  import PDFCreator from './pdfCreator.js';
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
      const theme = useTheme();

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
       * Druckbereich-Rechtecks — verändert dabei NICHT das Zoomlevel/die
       * Resolution der Kartenansicht; die Karte wird nur ganz kurz beim
       * eigentlichen Druckvorgang (createPdf -> alignViewToPrintArea)
       * temporär ausgerichtet und danach wieder auf den ursprünglichen
       * Zustand zurückgesetzt.
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
        console.log(theme.current.value.colors.primary);
        console.log(theme);
        if (feature.get(printAreaRoleKey) === printAreaHandleRole) {
          return new Style({
            image: new CircleStyle({
              radius: 7,
              //fill: new Fill({ color: theme.current.value.colors.secondary }),
              fill: new Fill({ color: theme.current.value.colors.primary }),
              stroke: new Stroke({ color: '#FFFFFF', width: 2 }),
            }),
          });
        }
        return new Style({
          stroke: new Stroke({
            //color: theme.current.value.colors.primary,
            color: 'red',
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
          },
          style: printAreaStyleFunction,
        });
        printAreaLayer.addFeatures([rectangleFeature!, handleFeature!]);
        app.layers.add(printAreaLayer);
        printAreaLayer.activate().catch((error: unknown) => {
          getLogger(plugin.name).error(
            `Activating print-area layer failed: ${error as string}`,
          );
        });

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
       * Schneidet aus dem vollflächigen Karten-Screenshot (`sourceCanvas`,
       * i.d.R. mit höherer Auflösung als das DOM-Element gerendert, für die
       * gewünschte Druck-PPI) genau den Bereich aus, der dem
       * Druckbereich-Rechteck entspricht — inkl. eventueller Rest-Rotation
       * (siehe computePrintAreaScreenRegion). `region` ist in DOM-Pixeln des
       * Karten-Elements angegeben und wird proportional auf die tatsächliche
       * Canvas-Größe skaliert.
       */
      function cropRotatedCanvasToPrintArea(
        sourceCanvas: HTMLCanvasElement,
        domSize: Size,
        region: {
          centerPixel: { x: number; y: number };
          widthPixel: number;
          heightPixel: number;
          rotation: number;
        },
      ): HTMLCanvasElement {
        const scaleX = sourceCanvas.width / domSize.width;
        const scaleY = sourceCanvas.height / domSize.height;

        const target = document.createElement('canvas');
        target.width = Math.round(region.widthPixel * scaleX);
        target.height = Math.round(region.heightPixel * scaleY);
        const ctx = target.getContext('2d');
        if (!ctx) {
          return sourceCanvas;
        }

        // Ursprung in die Zielmitte legen, die gemessene Bildschirm-Rotation
        // rückgängig machen, dann so verschieben, dass der Rechteck-
        // Mittelpunkt (in Canvas-Pixeln) auf dem neuen Ursprung liegt — und
        // das komplette Quellbild zeichnen. Nur der Teil innerhalb der
        // Zielgröße bleibt sichtbar (= der Zuschnitt).
        ctx.save();
        ctx.translate(target.width / 2, target.height / 2);
        ctx.rotate(-region.rotation);
        ctx.translate(
          -region.centerPixel.x * scaleX,
          -region.centerPixel.y * scaleY,
        );
        ctx.drawImage(sourceCanvas, 0, 0);
        ctx.restore();

        return target;
      }

      /**
       * Ermittelt, wo das Druckbereich-Rechteck NACH dem Ausrichten der View
       * (alignViewToPrintArea) tatsächlich auf dem Bildschirm liegt — in
       * DOM-Pixeln, inkl. tatsächlicher Rotation relativ zur Bildschirmachse.
       * Bewusst eine MESSUNG (via getPixelFromCoordinate) statt einer
       * Annahme: ob view.setRotation() die Rechteck-Rotation exakt aufhebt,
       * hängt von Vorzeichen-/Konventionsdetails ab, die hier nicht
       * unterstellt werden — das tatsächliche Ergebnis wird stattdessen
       * direkt aus der realen Projektion der vier Rechteck-Ecken abgelesen,
       * damit der Zuschnitt (cropRotatedCanvasToPrintArea) immer korrekt
       * ausgerichtet ist, unabhängig von dieser Konvention.
       */
      function computePrintAreaScreenRegion(map: OpenlayersMap):
        | {
            centerPixel: { x: number; y: number };
            widthPixel: number;
            heightPixel: number;
            rotation: number;
          }
        | undefined {
        if (!printAreaState) {
          return undefined;
        }
        // Die ersten 4 (von 5, der letzte schließt den Ring) Eckpunkte des
        // Rechtecks in Kartenkoordinaten, in Reihenfolge
        // [-halfW,-halfH] -> [halfW,-halfH] -> [halfW,halfH] -> [-halfW,halfH].
        const corners = getRectangleCoordinates(printAreaState).slice(0, 4);
        const pixelCorners = corners.map((coord) =>
          map.olMap.getPixelFromCoordinate(coord),
        );
        if (pixelCorners.some((pixel) => !pixel)) {
          return undefined;
        }
        const [p0, p1, p2] = pixelCorners as Pixel[];

        return {
          centerPixel: {
            x: (p0[0] + p2[0]) / 2,
            y: (p0[1] + p2[1]) / 2,
          },
          widthPixel: Math.hypot(p1[0] - p0[0], p1[1] - p0[1]),
          heightPixel: Math.hypot(p2[0] - p1[0], p2[1] - p1[1]),
          // Tatsächliche Bildschirm-Rotation des Rechtecks, gemessen (nicht
          // angenommen) — in Canvas-Rotationskonvention (y-Achse zeigt nach
          // unten), passend zu ctx.rotate() in cropRotatedCanvasToPrintArea.
          rotation: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]),
        };
      }

      /**
       * Richtet die Kartenansicht temporär exakt auf das Druckbereich-Rechteck
       * aus (Zentrum, Rotation, sowie eine Resolution, die das Rechteck
       * vollständig und unbeschnitten im Viewport zeigt — reine
       * Screenshot-Qualität/Framing) und liefert eine Restore-Funktion, um
       * die View danach wieder auf ihren ursprünglichen Zustand
       * zurückzusetzen. Gibt `undefined` zurück, wenn kein Rechteck aktiv
       * ist (z.B. 3D-/Oblique-Karte). Die tatsächliche Crop-Region wird NICHT
       * hier zurückgegeben, sondern separat per computePrintAreaScreenRegion
       * gemessen, nachdem die View ausgerichtet wurde (siehe createPdf) —
       * damit ist der Zuschnitt korrekt, selbst wenn view.setRotation() die
       * Rechteck-Rotation nicht exakt aufhebt.
       */
      function alignViewToPrintArea(
        map: OpenlayersMap,
        domSize: Size,
      ): { restore: () => void } | undefined {
        if (!printAreaState) {
          return undefined;
        }
        const view = map.olMap.getView();
        const originalCenter = view.getCenter();
        const originalResolution = view.getResolution();
        const originalRotation = view.getRotation();

        const rectState = printAreaState;
        // Resolution so wählen, dass das Rechteck in beiden Dimensionen
        // vollständig sichtbar ist (kein Beschnitt), unabhängig vom
        // Seitenverhältnis des Karten-Elements.
        const resolution = Math.max(
          rectState.width / domSize.width,
          rectState.height / domSize.height,
        );

        view.setRotation(rectState.rotation);
        view.setCenter(rectState.center);
        view.setResolution(resolution);

        return {
          restore: (): void => {
            view.setRotation(originalRotation ?? 0);
            if (originalCenter) {
              view.setCenter(originalCenter);
            }
            if (originalResolution !== undefined) {
              view.setResolution(originalResolution);
            }
          },
        };
      }

      /** Creates pdf by utilizing the PDFCreator. Handling is done by default function in shootScreenAndHandle.js */
      async function createPdf(): Promise<void> {
        running.value = true;
        const activeMap = app.maps.activeMap!;
        const mapElement = getMapElement(activeMap);
        const mapSize = getMapSize(activeMap);

        // Kartenansicht ggf. auf das Druckbereich-Rechteck ausrichten, damit
        // nur der durch das Rechteck vorgegebene Ausschnitt gedruckt wird.
        // Die tatsächliche Bildschirm-Region (inkl. Rotation) wird danach
        // GEMESSEN, nicht angenommen — siehe computePrintAreaScreenRegion.
        let printAreaAlignment: { restore: () => void } | undefined;
        let printAreaScreenRegion:
          | ReturnType<typeof computePrintAreaScreenRegion>
          | undefined;
        if (activeMap instanceof OpenlayersMap) {
          printAreaAlignment = alignViewToPrintArea(activeMap, mapSize);
          if (printAreaAlignment) {
            await waitForRenderComplete(activeMap);
            printAreaScreenRegion = computePrintAreaScreenRegion(activeMap);
          }
        }

        // Bei aktivem Druckbereich-Rechteck entspricht der gedruckte
        // Maßstab exakt printScale (die Rechteck-Größe wurde ja danach
        // berechnet) — ansonsten der bereits reaktiv gepflegte Maßstab der
        // vollen, unbeschnittenen Kartenansicht.
        const scale =
          is2DMap.value && (printAreaScreenRegion || currentScale.value)
            ? t('print.pdf.scale', {
                scale: printAreaScreenRegion
                  ? formatScaleDenominator(printScale.value)
                  : currentScale.value,
              })
            : undefined;

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
        console.log(config);
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
          })
          .then(async () => {
            // after setup possible to execute pdfCreator.create()
            const width =
              pdfCreator.imgPlacement!.size.width * state.selectedPpi;

            const baseCreateFn = printAreaScreenRegion
              ? async (
                  canvas: HTMLCanvasElement,
                  translate: (s: string) => string,
                ): Promise<Blob> => {
                  const cropped = cropRotatedCanvasToPrintArea(
                    canvas,
                    mapSize,
                    printAreaScreenRegion!,
                  );
                  return pdfCreator.create(cropped, translate);
                }
              : pdfCreator.create.bind(pdfCreator);

            // Rechteck/Rotationsgriff dürfen nicht mit aufs gedruckte Bild —
            // sobald der Screenshot als Canvas vorliegt, ist das Ausblenden
            // nicht mehr nötig und wird sofort wieder rückgängig gemacht
            // (nicht erst nach der kompletten PDF-Erstellung, um die
            // Ausblend-Dauer für den Nutzer so kurz wie möglich zu halten).
            const createFn = async (
              canvas: HTMLCanvasElement,
              translate: (s: string) => string,
            ): Promise<Blob> => {
              printAreaLayer?.activate().catch((error: unknown) => {
                getLogger(plugin.name).error(
                  `Reactivating print-area layer failed: ${error as string}`,
                );
              });
              return baseCreateFn(canvas, translate);
            };

            printAreaLayer?.deactivate();
            if (activeMap instanceof OpenlayersMap) {
              // Sicherstellen, dass das Ausblenden im nächsten Render-Zyklus
              // auch tatsächlich im Bild ankommt, bevor der Screenshot startet.
              await waitForRenderComplete(activeMap);
            }

            await createAndHandleBlob(
              app,
              width,
              createFn,
              'map.pdf',
              overlayWindows,
            );
          })
          .catch((e: unknown) => {
            app.notifier.add({
              type: NotificationType.ERROR,
              message: (e as Error).message,
            });
          })
          .finally(() => {
            printAreaAlignment?.restore();
            // Sicherheitsnetz: falls createFn nie aufgerufen wurde (z.B.
            // Fehler vor dem eigentlichen Screenshot), Layer trotzdem wieder
            // einblenden. activate() auf einem bereits aktiven Layer ist
            // ungefährlich (No-Op).
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