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
  import { computed, defineComponent, inject, onUnmounted, ref } from 'vue';
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
   * Fixed (fiktive) Breite/Höhe des Druckbereich-Rechtecks in Karteneinheiten
   * (z.B. Meter bei projizierten Koordinatensystemen). Später ggf. aus
   * Format/Orientierung/PPI ableitbar.
   */
  const printAreaWidth = 500;
  const printAreaHeight = 350;

  /**
   * Cursor über dem Rotationsgriff: kreisförmig angeordneter Pfeil (Rotate-Icon)
   * als Daten-URI-SVG, mit "grab" als Fallback für Browser ohne Custom-Cursor-Support.
   */
  const rotateCursorSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path fill="#000000" stroke="#FFFFFF" stroke-width="1" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0020 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 004 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>' +
    '</svg>';
  const rotateCursorStyle = `url("data:image/svg+xml,${encodeURIComponent(
    rotateCursorSvg,
  )}") 12 12, grab`;

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

      // State whether calculation is running.
      const running = ref(false);

      // --- Maßstab Logik ---
      const currentScale = ref<string>('');
      const is2DMap = ref(false);
      let resolutionListenerKey: EventsKey | null = null;

      /** Formatiert eine View-Resolution (m/px) als "1:x"-Maßstabsangabe. */
      function formatScaleLabel(resolution: number): string {
        const scale = Math.round(resolution * 39.37 * 96);
        return `1:${scale.toLocaleString('de-DE')}`;
      }

      const updateScale = (): void => {
        const activeMap = app.maps.activeMap;
        if (!(activeMap instanceof OpenlayersMap)) {
          return;
        }
        const resolution = activeMap.olMap.getView().getResolution();
        if (resolution) {
          currentScale.value = formatScaleLabel(resolution);
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

      /** Rotationsgriff: Füllung in Sekundärfarbe, weißer Rand. Rechteck: Umrandung in Primärfarbe. */
      function printAreaStyleFunction(feature: FeatureLike): Style {
        if (feature.get(printAreaRoleKey) === printAreaHandleRole) {
          return new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: theme.current.value.colors.secondary }),
              stroke: new Stroke({ color: '#FFFFFF', width: 2 }),
            }),
          });
        }
        return new Style({
          stroke: new Stroke({
            color: theme.current.value.colors.primary,
            width: 2,
          }),
        });
      }

      /**
       * Erstellt Rechteck- und Rotationsgriff-Feature mit fester Breite/Höhe
       * (printAreaWidth / printAreaHeight, in Karteneinheiten), zentriert auf
       * den aktuellen Mittelpunkt der 2D-Kartenansicht.
       */
      function createPrintAreaFeatures(map: OpenlayersMap): boolean {
        const center = map.olMap.getView().getCenter();
        if (!center) {
          return false;
        }

        printAreaState = {
          center: [center[0], center[1]],
          width: printAreaWidth,
          height: printAreaHeight,
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
       */
      function createPrintAreaInteraction(): PointerInteraction {
        let dragMode: 'translate' | 'rotate' | null = null;
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
              dragMode = 'rotate';
              baseHandleAngle = Math.atan2(
                printAreaState.height / 2,
                printAreaState.width / 2,
              );
              return true;
            }

            if (isPixelOverRectangle(map, evt.pixel)) {
              dragMode = 'translate';
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
            if (dragMode === 'rotate') {
              const dx = evt.coordinate[0] - printAreaState.center[0];
              const dy = evt.coordinate[1] - printAreaState.center[1];
              printAreaState.rotation = Math.atan2(dy, dx) - baseHandleAngle;
              updatePrintAreaGeometries();
            } else if (
              dragMode === 'translate' &&
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
            dragMode = null;
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
       * Druckbereich-Rechteck entspricht. `region` ist in DOM-Pixeln des
       * Karten-Elements angegeben und wird proportional auf die tatsächliche
       * Canvas-Größe skaliert.
       */
      function cropCanvasToPrintArea(
        sourceCanvas: HTMLCanvasElement,
        domSize: Size,
        region: { x: number; y: number; width: number; height: number },
      ): HTMLCanvasElement {
        const scaleX = sourceCanvas.width / domSize.width;
        const scaleY = sourceCanvas.height / domSize.height;

        const sx = region.x * scaleX;
        const sy = region.y * scaleY;
        const sWidth = region.width * scaleX;
        const sHeight = region.height * scaleY;

        const target = document.createElement('canvas');
        target.width = Math.round(sWidth);
        target.height = Math.round(sHeight);
        const ctx = target.getContext('2d');
        if (!ctx) {
          return sourceCanvas;
        }
        ctx.drawImage(
          sourceCanvas,
          sx,
          sy,
          sWidth,
          sHeight,
          0,
          0,
          target.width,
          target.height,
        );
        return target;
      }

      /**
       * Richtet die Kartenansicht temporär exakt auf das Druckbereich-Rechteck
       * aus (Zentrum, Rotation, sowie eine Resolution, die das Rechteck
       * vollständig und unbeschnitten im Viewport zeigt) und liefert sowohl
       * eine Restore-Funktion als auch die Pixel-Region (in DOM-Koordinaten
       * des Karten-Elements), auf die der spätere Screenshot zugeschnitten
       * werden muss. Gibt `undefined` zurück, wenn kein Rechteck aktiv ist
       * (z.B. 3D-/Oblique-Karte).
       */
      function alignViewToPrintArea(
        map: OpenlayersMap,
        domSize: Size,
      ): { region: { x: number; y: number; width: number; height: number }; aspectRatio: number; scaleLabel: string; restore: () => void } | undefined {
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

        const region = {
          x: domSize.width / 2 - rectState.width / resolution / 2,
          y: domSize.height / 2 - rectState.height / resolution / 2,
          width: rectState.width / resolution,
          height: rectState.height / resolution,
        };

        return {
          region,
          aspectRatio: rectState.width / rectState.height,
          scaleLabel: formatScaleLabel(resolution),
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
        let printAreaAlignment:
          | ReturnType<typeof alignViewToPrintArea>
          | undefined;
        if (activeMap instanceof OpenlayersMap) {
          printAreaAlignment = alignViewToPrintArea(activeMap, mapSize);
          if (printAreaAlignment) {
            await waitForRenderComplete(activeMap);
          }
        }

        // Verwendet entweder den auf das Rechteck bezogenen Maßstab, oder
        // (ohne aktives Rechteck) den bereits reaktiv gepflegten Maßstab der
        // vollen Kartenansicht.
        const scale =
          is2DMap.value && (printAreaAlignment?.scaleLabel || currentScale.value)
            ? t('print.pdf.scale', {
                scale: printAreaAlignment?.scaleLabel ?? currentScale.value,
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

        const mapAspectRatio =
          printAreaAlignment?.aspectRatio ?? mapSize.width / mapSize.height;

        const pdfCreator = new PDFCreator();
        await pdfCreator
          .setup({
            orientation: state.selectedOrientation,
            format: state.selectedFormat,
            title: state.title,
            logo,
            imgRatio: mapAspectRatio,
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

            const createFn = printAreaAlignment
              ? async (
                  canvas: HTMLCanvasElement,
                  translate: (s: string) => string,
                ): Promise<Blob> => {
                  const cropped = cropCanvasToPrintArea(
                    canvas,
                    mapSize,
                    printAreaAlignment!.region,
                  );
                  return pdfCreator.create(cropped, translate);
                }
              : pdfCreator.create.bind(pdfCreator);

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
        running,
        createPdf,
        is2DMap,
        currentScale,
      };
    },
  });
</script>

<style lang="scss" scoped></style>