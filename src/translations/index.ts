import enCommon from './en/common';
import enAuth from './en/auth';
import enAdmin from './en/admin';
import enMenu from './en/menu';

import zhCommon from './zh/common';
import zhAuth from './zh/auth';
import zhAdmin from './zh/admin';
import zhMenu from './zh/menu';

import msCommon from './ms/common';
import msAuth from './ms/auth';
import msAdmin from './ms/admin';
import msMenu from './ms/menu';

export const translations = {
  en: {
    ...enCommon,
    ...enAuth,
    ...enAdmin,
    ...enMenu,
  },
  zh: {
    ...zhCommon,
    ...zhAuth,
    ...zhAdmin,
    ...zhMenu,
  },
  ms: {
    ...msCommon,
    ...msAuth,
    ...msAdmin,
    ...msMenu,
  },
} as const;
