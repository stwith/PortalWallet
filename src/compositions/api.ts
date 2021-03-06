import { Notify, Cookies, LocalStorage, copyToClipboard } from 'quasar';
import axios, { AxiosError } from 'axios';
import { useConfig } from './config';
import PWCore, { Amount, AmountUnit, Transaction } from '@lay2/pw-core';
import { SwapTX, SwapTxStatus, SwapConfig, SwapRates } from './swap';
import * as jwt from 'jsonwebtoken';
import { Contact, useShowLogin } from './account';
import { CATE, SKU } from './shop/sku';
import { Order, CardStatus, Card } from './shop/order';
import ABCWallet from 'abcwallet';
import { i18n } from 'src/boot/i18n';
import { useShopConfig } from './shop/shop';
import GTM from '../compositions/gtm';

const apiGet = async (
  url: string,
  params?: Record<string, string | undefined>,
  authorization?: boolean
) => get(useConfig().api_base + url, params, authorization);

const apiPost = async (
  url: string,
  params: Record<string, unknown>,
  authorization?: boolean
) => post(useConfig().api_base + url, params, authorization);

const apiDelete = async (
  url: string,
  params?: Record<string, string | undefined>,
  authorization?: boolean
) => del(useConfig().api_base + url, params, authorization);

export function useApi() {
  return {
    login: async (address: string, timestamp: number, signature: string) => {
      const res = await apiPost('/auth/login', {
        address,
        timestamp,
        signature
      });
      if (res?.status === 201) {
        const { accessToken, refreshToken } = res.data as Record<
          string,
          string
        >;
        return { accessToken, refreshToken };
      } else {
        throw new Error('Authorization failed!');
      }
    },

    loadPortalAddress: async (fullAddress: string) => {
      const res = await apiGet('/wallet/address', { address: fullAddress });
      if (res?.data) return (res.data as Record<string, string>).address;
    },

    addNote: async (txHash: string, remark: string) => {
      const res = await apiPost('/user/txremarks', { txHash, remark }, true);
      if (res?.status !== 201) {
        throw new Error(`Add note failed: ${txHash}, ${remark}`);
      }
    },

    addContact: async (contact: Contact) => {
      const res = await apiPost('/user/contacts', { ...contact }, true);
      if (res?.status !== 201) {
        throw new Error(`Add contact failed: ${JSON.stringify(contact)}`);
      }
    },

    deleteContact: async (contactId: number) => {
      const res = await apiDelete(
        `/user/contacts/${contactId}`,
        undefined,
        true
      );
      if (res?.status !== 200) {
        throw new Error(`Delete contact failed: ${contactId}`);
      }
    },

    loadContacts: async (): Promise<Contact[]> => {
      const res = await apiGet('/user/contacts', undefined, true);
      const contacts: Contact[] = [];

      if (res?.status === 200) {
        for (const c of res.data as Contact[]) {
          contacts.push(c);
        }
      }

      return contacts;
    },

    loadTxRecords: async (
      lockHash: string,
      lastHash: string | undefined,
      size = 10,
      direction = 'all'
    ) =>
      ((
        await apiGet(
          '/cell/txList',
          {
            lockHash,
            lastHash,
            size: `${size}`,
            direction
          },
          true
        )
      )?.data as Record<string, string | number>[]) || [],

    loadDao: async (lockHash: string) => {
      const dao = (await apiGet('/dao/stats', { lockHash }))?.data as {
        global: { estimated_apc: string };
        user: { locked: string; yesterday: string; yieldCumulative: string };
      };

      const locked = new Amount(dao.user.locked, AmountUnit.shannon);
      const yesterday = new Amount(dao.user.yesterday, AmountUnit.shannon);
      const cumulative = new Amount(
        dao.user.yieldCumulative,
        AmountUnit.shannon
      );
      const apc = new Number(dao.global.estimated_apc).toFixed(2);

      return { locked, yesterday, cumulative, apc };
    },

    loadSwapConfig: async () => {
      return (await apiGet('/swap/config'))?.data as SwapConfig;
    },

    loadSwapRates: async () => {
      const rates = (await apiGet('/swap/tokenRate'))?.data as SwapRates;
      return rates;
    },

    loadSwapTxs: async (address: string, size: number, lastId?: number) => {
      let params: Record<string, string> = { address, size: size.toString() };
      !!lastId && (params = { ...params, lastId: lastId.toString() });
      const res = (await apiGet('/swap/transactions', params))?.data as Record<
        string,
        { [key: string]: string | number }
      >[];
      const txs: SwapTX[] = [];

      if (res) {
        for (const tx of res) {
          txs.push(
            new SwapTX(
              (tx.id as unknown) as number,
              tx.from.amount as string,
              tx.from.decimal as number,
              tx.from.hash as string,
              tx.from.symbol as string,
              tx.to.amount as string,
              tx.to.decimal as number,
              tx.to.hash as string,
              tx.to.symbol as string,
              (tx.time as unknown) as number,
              (tx.status as unknown) as SwapTxStatus
            )
          );
        }
      }

      return txs;
    },

    submitPendingSwap: async (
      txhash: string,
      nonce: number,
      ckbAmount: string,
      tokenSymbol: string,
      tokenAmount: string,
      from: string
    ) =>
      await apiPost('/swap/submitPendingSwap', {
        txhash,
        nonce,
        ckbAmount,
        tokenSymbol,
        tokenAmount,
        from
      }),
    shop: {
      loadConfig: async () => {
        const res = await apiGet('/store/config');
        if (res?.status === 200) {
          const paymentList = (res.data as Record<string, []>)
            .receivePaymentList as { address: string; token: string }[];
          useShopConfig().value = {
            address: paymentList[0].address,
            ...((res.data as Record<string, unknown>).service as {
              name: string;
              img: string;
            })
          };
        }
      },
      loadBanners: async (): Promise<{ img: string; link: string }[]> => {
        const res = await apiGet('/store/banners');
        let banners: { img: string; link: string }[] = [];
        if (res?.data) {
          banners = res.data as { img: string; link: string }[];
        }
        return banners;
      },
      loadCategories: async (): Promise<CATE[]> => {
        const res = await apiGet('/store/categories');
        let categories: CATE[] = [];
        if (res?.data) {
          categories = res.data as CATE[];
          categories = categories.sort((a, b) => a.id - b.id);
        }
        return categories;
      },

      loadSelectedSkus: async () => {
        const res = await apiGet('/store/selectedProducts');
        if (res?.status === 200) {
          return res.data as SKU[];
        }
      },
      loadSku: async (skuId: number) => {
        const res = await apiGet(`/store/productInfo/${skuId}`);
        if (res?.status === 200) {
          return res.data as SKU;
        }
      },
      loadSkus: async (cateId: number): Promise<SKU[]> => {
        if (cateId) {
          const res = await apiGet('/store/productList/', {
            cid: cateId.toString()
          });
          if (res?.data) {
            const skus: SKU[] = [];
            for (const sku of res.data) {
              skus.push({ ...sku, cid: cateId });
            }
            return skus;
          }
        }
        return [];
      },

      placeOrder: async (
        sid: number,
        count: number,
        phoneNumber?: string,
        rechargeAmount?: number
      ) => {
        const res = await apiPost(
          '/store/placeOrder',
          {
            productId: sid,
            num: count,
            rechargeNo: phoneNumber,
            rechargeAmount
          },
          true
        );

        console.log('[api] placeOrder', res);

        if (res?.status === 201) {
          const { orderNo } = res.data as Record<string, string>;
          return orderNo;
        }
      },

      prePayOrder: async (orderNo: string, token = 'CKB') => {
        const res = await apiPost(
          '/store/prePayOrder',
          { orderNo, token },
          true
        );
        if (res?.status === 201) {
          const { tokenAmount, expiresIn } = res.data as {
            tokenAmount: string;
            expiresIn: number;
          };

          return { tokenAmount, expiresIn };
        }
      },

      payOrder: async (orderNo: string, tx: Transaction, token = 'CKB') => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        const signedTx = tx.transform() as Record<string, unknown>;
        const res = await apiPost(
          '/store/payOrder',
          { orderNo, token, signedTx },
          true
        );
        if (res?.status === 201) {
          return true;
        }

        return false;
      },

      loadCards: async (
        status: CardStatus,
        size: number,
        lastOrderId?: number
      ) => {
        const res = await apiGet(
          '/store/cardList',
          {
            status: `${status}`,
            size: `${size}`,
            lastOrderId: `${lastOrderId || 0}`
          },
          true
        );

        if (res?.status === 200) {
          return res.data as Card[];
        }

        return [];
      },

      loadOrder: async (orderNo: string) => {
        const res = await apiGet('/store/queryOrder', { orderNo }, true);

        if (res?.status === 200) {
          return res.data as Order;
        }
      },

      loadOrders: async (size: number, lastOrderId?: number) => {
        const res = await apiGet(
          '/store/orderList',
          {
            size: `${size}`,
            lastOrderId: `${lastOrderId || 0}`
          },
          true
        );

        if (res?.status === 200) {
          return res.data as Order[];
        }
      }
    }
  };
}

export const checkAuthorization = async (
  address: string,
  bypass = false
): Promise<string | undefined> => {
  const AT = Cookies.get('AT+' + address);
  if (!!AT) {
    const { exp } = jwt.decode(AT) as Record<string, number>;
    if (new Date().getTime() < exp * 1000 || bypass) {
      return AT;
    } else {
      const RT = LocalStorage.getItem('RT+' + address);
      console.log('[api] RT: ', RT);
      if (!!RT) {
        try {
          const { accessToken, refreshToken } = (
            await apiGet(
              '/auth/refreshToken',
              { refreshToken: RT.toString() },
              true
            )
          )?.data as Record<string, string>;
          Cookies.set('AT+' + address, accessToken);
          LocalStorage.set('RT+' + address, refreshToken);
          return accessToken;
        } catch (e) {}
      }
    }
  }
};

interface ApiResponse {
  code: number;
  msg: string;
  data: unknown;
}

export const get = async (
  url: string,
  params?: Record<string, string | undefined>,
  authorization?: boolean
) => {
  let config = undefined;
  if (authorization) {
    if (PWCore.provider === undefined) return;
    const AT = await checkAuthorization(
      PWCore.provider.address.addressString,
      url.endsWith('refreshToken')
    );
    config = {
      headers: { Authorization: `Bearer ${AT || ''}` }
    };
  }

  url += '?';
  for (const p in params) {
    if (params[p] !== undefined) {
      url += `${p}=${params[p] as string}&`;
    }
  }
  let ret = null;
  console.log('[apiGet] url: ', url);
  try {
    ret = await axios.get(url, config);
  } catch (e) {
    GTM.logEvent({
      category: 'Exceptions',
      action: `[API GET] - ${url.split('/').pop() || ''}`,
      label: `Error: ${(e as Error).message} | Params: ${JSON.stringify(
        params
      )}`,
      value: new Date().getTime()
    });
    if ((e as AxiosError).response?.status === 401) {
      useShowLogin().value = true;
      return;
    }
    Notify.create({
      message: `[API] - ${(e as Error).toString()}`,
      position: 'top',
      timeout: 2000,
      color: 'negative'
    });
  }

  console.log('[api] get ret', ret);

  if (ret?.data) {
    ret.data = (ret?.data as ApiResponse).data;
  }

  return ret;
};

const post = async (
  url: string,
  params: Record<string, unknown>,
  authorization?: boolean
) => {
  let config = undefined;
  if (authorization) {
    if (PWCore.provider === undefined) return;
    const AT = await checkAuthorization(
      PWCore.provider.address.addressString,
      url.endsWith('refreshToken')
    );
    config = {
      headers: { Authorization: `Bearer ${AT || ''}` }
    };
  }

  console.log('[apiPost]', url, JSON.stringify(params));

  let ret = null;
  try {
    ret = await axios.post(url, params, config);
  } catch (e) {
    GTM.logEvent({
      category: 'Exceptions',
      action: `[API POST] - ${url.split('/').pop() || ''}`,
      label: `Error: ${(e as Error).message} | Params: ${JSON.stringify(
        params
      )}`,
      value: new Date().getTime()
    });
    if ((e as AxiosError).response?.status === 401) {
      useShowLogin().value = true;
      return;
    }
    Notify.create({
      message: `[API] - ${(e as Error).message} Params: ${JSON.stringify(
        params
      )}`,
      position: 'top',
      timeout: 2000,
      color: 'negative'
    });
  }

  if (ret?.data) {
    ret.data = (ret?.data as ApiResponse).data;
  }

  return ret;
};

const del = async (
  url: string,
  params?: Record<string, string | undefined>,
  authorization?: boolean
) => {
  let config = undefined;
  if (authorization) {
    if (PWCore.provider === undefined) return;
    const AT = await checkAuthorization(
      PWCore.provider.address.addressString,
      url.endsWith('refreshToken')
    );
    config = {
      headers: { Authorization: `Bearer ${AT || ''}` }
    };
  }

  url += '?';
  for (const p in params) {
    if (params[p] !== undefined) {
      url += `${p}=${params[p] as string}&`;
    }
  }
  let ret = null;
  console.log('[apiDelete] url: ', url);
  try {
    ret = await axios.delete(url, config);
  } catch (e) {
    GTM.logEvent({
      category: 'Exceptions',
      action: `[API DEL] - ${url.split('/').pop() || ''}`,
      label: `Error: ${(e as Error).message} | Params: ${JSON.stringify(
        params
      )}`,
      value: new Date().getTime()
    });
    if ((e as AxiosError).response?.status === 401) {
      useShowLogin().value = true;
      return;
    }
    Notify.create({
      message: `[API] - ${(e as Error).toString()}`,
      position: 'top',
      timeout: 2000,
      color: 'negative'
    });
  }

  console.log('[api] delete ret', ret);

  if (ret?.data) {
    ret.data = (ret?.data as ApiResponse).data;
  }

  return ret;
};

export const copy = async (content: string) => {
  try {
    await copyToClipboard(content);
  } catch (e) {
    if (useConfig().platform === 'ImToken') {
      window.imToken.callAPI('native.setClipboard', content);
    } else if (useConfig().platform === 'ABCWallet') {
      await ABCWallet.webview.copy({ text: content });
    } else {
      console.log(e); // long address not work on android
      return;
    }
  }
  console.log('[api] copied: ', content);
  Notify.create({
    message: i18n.t('common.copied').toString(),
    position: 'top',
    timeout: 2000,
    color: 'positive'
  });
};
