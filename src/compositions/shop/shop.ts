import { Transaction } from '@lay2/pw-core';
import { ref } from '@vue/composition-api';
import { useApi } from '../api';

const orderNo = ref<string | undefined>();
export function useOrderNo() {
  return orderNo;
}

const config = ref<{ address: string; name: string; img: string }>();
export function useShopConfig() {
  return config;
}

export async function payOrder(tx: Transaction) {
  if (!!orderNo.value) {
    await useApi().shop.payOrder(orderNo.value, tx);
    return orderNo.value;
  }

  return false;
}
