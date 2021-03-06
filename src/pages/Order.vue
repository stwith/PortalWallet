<template>
  <q-page class="column">
    <q-toolbar v-if="showHeader" class="bg-accent text-white">
      <q-btn flat size="sm" round icon="arrow_back_ios" to="/shop" replace />
      <q-toolbar-title class="text-center text-subtitle1 text-bold">{{ $t('order.title') }}</q-toolbar-title>
      <q-btn flat round icon="more_vert" class="invisible" />
    </q-toolbar>
    <div v-if="sku" class="col column justify-between">
      <q-card class="q-ma-md">
        <img :src="sku.img" />
        <q-card-section>
          <div class="row justify-between">
            <div class="text-h6">{{ sku.name }}</div>
            <div class="text-h6 text-negative">¥ {{ sku.sellPrice / 100 }}</div>
          </div>
          <q-separator spaced />
          <div class="text-caption text-dark" style="white-space: pre-line;">{{ sku.description }}</div>
        </q-card-section>
      </q-card>
      <q-card class="q-ma-md">
        <q-card-section class="col row justify-between bg-accent text-white q-pa-none">
          <div class="col column q-pl-xs justify-center">
            <div class="column q-pa-sm q-gutter-xs">
              <div style="font-size:1.5em; line-height: 1">{{ amount }} CKB</div>
              <div
                style="font-size:0.8em; line-height: 1"
                class="text-grey"
              >{{`1 CKB = ${rate} CNY`}}</div>
            </div>
            <fee-bar :builder="builder" class="hidden" />
          </div>
          <q-btn
            class="bg-warning q-px-md"
            flat
            no-caps
            size="1.3em"
            color="accent"
            :loading="placingOrder"
            :disable="placingOrder"
            :label="$t('order.btn.pay')"
            @click="onPay"
          />
        </q-card-section>
      </q-card>
    </div>
  </q-page>
</template>

<script lang="ts">
import {
  defineComponent,
  computed,
  ref,
  onMounted,
  watch,
} from '@vue/composition-api';
import { SKU } from '../compositions/shop/sku';
import { useApi } from '../compositions/api';
import { Amount, Address, AddressType, SimpleBuilder } from '@lay2/pw-core';
import {
  useConfirmSend,
  useReceivePair,
  useSending,
  useSendMode,
} from '../compositions/send';
import { Notify, Loading, QSpinnerBall } from 'quasar';
import { i18n } from '../boot/i18n';
import FeeBar from '../components/FeeBar.vue';
import { useOrderNo, useShopConfig } from '../compositions/shop/shop';
import { useConfig } from '../compositions/config';
import { useAccount, useAuthorized } from 'src/compositions/account';
import GTM from '../compositions/gtm';

export default defineComponent({
  name: 'Order',
  components: { FeeBar },
  props: {
    sid: {
      type: String,
      required: true,
    },
  },
  setup(props, { root }) {
    const sku = ref<SKU | undefined>();
    const orderNo = useOrderNo();
    const tokenAmount = ref<Amount | undefined>();
    const expiresIn = ref(0);
    const placingOrder = ref(false);
    const builder = ref<SimpleBuilder | undefined>();
    const sending = useSending();

    onMounted(async () => {
      await init();
    });

    const amount = computed(() =>
      (tokenAmount.value || Amount.ZERO).toString(undefined, { commify: true })
    );

    const rate = computed(() => {
      if (sku.value && tokenAmount.value) {
        return (
          sku.value.sellPrice /
          100 /
          Number(tokenAmount.value.toString())
        ).toFixed(4);
      }
      return 0;
    });

    const stop = watch(useAuthorized(), (auth) => {
      stop();
      auth && init();
    });

    const init = async () => {
      loading(true);

      useSendMode().value = 'remote';
      sku.value = await useApi().shop.loadSku(Number(props.sid));
      const config = useShopConfig();
      if (!config.value) {
        await useApi().shop.loadConfig();
      }
      if (!!config.value) {
        useReceivePair().address = new Address(
          config.value.address,
          AddressType.ckb
        );
      } else {
        throw new Error('Shop config undefined');
      }

      loading(false);

      placingOrder.value = true;
      orderNo.value = await useApi().shop.placeOrder(Number(props.sid), 1);
      if (!!orderNo.value) {
        const res = await useApi().shop.prePayOrder(orderNo.value);
        if (!!res) {
          tokenAmount.value = new Amount(res.tokenAmount);
          useReceivePair().amount = tokenAmount.value;
          expiresIn.value = res.expiresIn;

          builder.value = new SimpleBuilder(
            useReceivePair().address as Address,
            useReceivePair().amount as Amount
          );
        }
      }
      placingOrder.value = false;
    };

    const onPay = () => {
      if (expiresIn.value < new Date().getTime()) {
        Notify.create({
          type: 'negative',
          message: i18n.t('order.msg.expired').toString(),
          timeout: 3000,
        });
        return;
      }
      if (tokenAmount.value instanceof Amount) {
        if (useAccount().balance.value?.lte(tokenAmount.value)) {
          Notify.create({
            type: 'warning',
            message: i18n.t('order.msg.notEnough').toString(),
            progress: true,
            actions: [
              { label: root.$t('order.btn.cancel'), color: 'white' },
              {
                label: root.$t('order.btn.home'),
                color: 'accent',
                handler: () => {
                  void root.$router.push('/');
                },
              },
            ],
          });
          GTM.logEvent({
            category: 'Fail',
            action: 'pay-order',
            label: 'insufficient-balance',
            value: new Date().getTime(),
          });
          return;
        }
        useConfirmSend().value = true;
        const stop = watch(sending, (sending) => {
          if (!sending) {
            GTM.logEvent({
              category: 'Conversions',
              action: 'pay-order',
              label: sku.value?.name || '',
              value: Number(tokenAmount.value?.toString()),
            });
            root.$q
              .dialog({
                title: root.$t('order.label.success').toString(),
                message: root.$t('order.msg.paid').toString(),
                ok: {
                  flat: true,
                  label: root.$t('order.btn.checkOrders'),
                  noCaps: true,
                },
                cancel: {
                  color: 'grey',
                  flat: true,
                  label: root.$t('order.btn.cancel'),
                  noCaps: true,
                },
                persistent: true,
              })
              .onOk(() => {
                void root.$router.push('/shop/orders');
              });
            stop();
          }
        });
      }
    };

    return {
      showHeader: useConfig().showHeader,
      sku,
      rate,
      placingOrder,
      amount,
      onPay,
      builder,
    };
  },
});

function loading(show = false) {
  show
    ? Loading.show({
        spinner: (QSpinnerBall as unknown) as Vue,
        spinnerColor: 'accent',
        spinnerSize: 64,
        messageColor: 'white',
        backgroundColor: 'primary',
      })
    : Loading.hide();
}
</script>
