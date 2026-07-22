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
  import { getLogger } from '@vcsuite/logger';
  import type { PrintPlugin } from '../index.js';
  import type { CanvasAndPlacement } from './pdfCreator.js';
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

  /**
   * Erkennung einer 2D (OpenlayersMap) Karte über den className-Diskriminator
   * statt instanceof, da das Plugin ggf. eine eigene @vcmap/core-Bundle-Instanz
   * einbindet und instanceof-Checks daher über Bundle-Grenzen hinweg fehlschlagen können.
   */
  function isOpenlayersMap(map: unknown): map is { olMap: any } {
    return (map as any)?.className === 'OpenlayersMap';
  }

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

      // State whether calculation is running.
      const running = ref(false);

      // --- Maßstab Logik ---
      const currentScale = ref<string>('');
      const is2DMap = ref(false);
      let resolutionListenerKey: EventsKey | null = null;

      const updateScale = (): void => {
        const activeMap = app.maps.activeMap as any;
        const resolution = activeMap?.olMap?.getView().getResolution();
        if (resolution) {
          const scale = Math.round(resolution * 39.37 * 96);
          currentScale.value = `1:${scale.toLocaleString('de-DE')}`;
        }
      };

      function detachResolutionListener(): void {
        if (resolutionListenerKey) {
          unByKey(resolutionListenerKey);
          resolutionListenerKey = null;
        }
      }

      function handleMapActivated(newMap: unknown): void {
        detachResolutionListener();
        is2DMap.value = isOpenlayersMap(newMap);
        if (is2DMap.value) {
          const map = newMap as { olMap: any };
          updateScale();
          resolutionListenerKey = map.olMap
            .getView()
            .on('change:resolution', updateScale);
        } else {
          currentScale.value = '';
        }
      }

      // einmalig für den initialen Zustand beim Öffnen des Windows,
      // da mapActivated nur zukünftige Wechsel meldet
      handleMapActivated(app.maps.activeMap);

      // meldet sich auch, während das Window bereits offen ist und die
      // Karte gewechselt wird (2D <-> 3D <-> Oblique <-> Panorama)
      const mapActivatedListener = app.maps.mapActivated.addEventListener(
        handleMapActivated,
      );
      // --- ENDE Maßstab Logik ---

      /** Creates pdf by utilizing the PDFCreator. Handling is done by default function in shootScreenAndHandle.js */
      async function createPdf(): Promise<void> {
        running.value = true;
        const activeMap = app.maps.activeMap!;
        const mapElement = getMapElement(activeMap);
        const mapSize = getMapSize(activeMap);

        // Verwendet den bereits reaktiv gepflegten Maßstab inkl. übersetztem Präfix,
        // nur wenn eine 2D-Karte aktiv ist.
        const scale =
          is2DMap.value && currentScale.value
            ? t('print.pdf.scale', { scale: currentScale.value })
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

        const mapAspectRatio = mapSize.width / mapSize.height;

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

            await createAndHandleBlob(
              app,
              width,
              pdfCreator.create.bind(pdfCreator),
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
            running.value = false;
          });
      }

      onUnmounted(() => {
        destroy();
        featureInfoListener();
        detachResolutionListener();
        mapActivatedListener();
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