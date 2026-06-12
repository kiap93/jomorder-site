import { translations } from '../translations';

export type LanguageCode = 'en' | 'ms' | 'zh';

/**
 * Robustly formats any numerical currency amount using dynamic ISO currency codes.
 * Ensures that hardcoded representations are avoided across the platform.
 */
export function formatCurrency(amount: number, currencyCode: string = 'MYR'): string {
  try {
    const code = (currencyCode || 'MYR').toUpperCase();
    const formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${code} ${formatter.format(amount)}`;
  } catch (e) {
    const code = (currencyCode || 'MYR').toUpperCase();
    return `${code} ${(amount || 0).toFixed(2)}`;
  }
}

interface TaxCalculationParams {
  subtotal: number;
  taxRate: number;
  taxType: string;
  taxEnabled?: boolean;
}

export interface TaxResult {
  taxName: string;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  totalWithTax: number;
}

/**
 * Universal dynamic tax calculation engine supporting multiple tax strategies (SST, GST, VAT, Sales Tax, etc.)
 */
export function calculateTax({ subtotal, taxRate, taxType, taxEnabled = true }: TaxCalculationParams): TaxResult {
  const normType = (taxType || 'SST').trim();
  
  if (!taxEnabled || normType === 'No Tax' || !taxRate || taxRate <= 0) {
    return {
      taxName: normType === 'No Tax' ? 'No Tax' : normType,
      taxRate: 0,
      taxAmount: 0,
      subtotal,
      totalWithTax: subtotal
    };
  }

  const rate = Number(taxRate) / 100;
  const taxAmount = subtotal * rate;
  return {
    taxName: normType,
    taxRate: Number(taxRate),
    taxAmount,
    subtotal,
    totalWithTax: subtotal + taxAmount
  };
}

/**
 * Formats timestamps elegantly using a business's local date format setting (DD/MM/YYYY or MM/DD/YYYY).
 */
export function formatDate(dateInput: string | Date | undefined | null, dateFormat: string = 'DD/MM/YYYY'): string {
  if (!dateInput) return '';
  try {
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return String(dateInput);

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();

    if (dateFormat === 'MM/DD/YYYY') {
      return `${mm}/${dd}/${yyyy}`;
    }
    return `${dd}/${mm}/${yyyy}`;
  } catch (e) {
    return String(dateInput);
  }
}

/**
 * Country Profile Constants containing localization presets for setup wizards and country selector options.
 */
export interface CountryPreset {
  countryName: string;
  countryCode: string;
  currency: string;
  timezone: string;
  language: string;
  taxType: 'SST' | 'GST' | 'VAT' | 'Sales Tax' | 'No Tax';
  taxRate: number;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY';
}

export const COUNTRY_PRESETS: Record<string, CountryPreset> = {
  MY: {
    countryName: 'Malaysia',
    countryCode: 'MY',
    currency: 'MYR',
    timezone: 'Asia/Kuala_Lumpur',
    language: 'ms',
    taxType: 'SST',
    taxRate: 6.0,
    dateFormat: 'DD/MM/YYYY'
  },
  SG: {
    countryName: 'Singapore',
    countryCode: 'SG',
    currency: 'SGD',
    timezone: 'Asia/Singapore',
    language: 'en',
    taxType: 'GST',
    taxRate: 9.0,
    dateFormat: 'DD/MM/YYYY'
  },
  TH: {
    countryName: 'Thailand',
    countryCode: 'TH',
    currency: 'THB',
    timezone: 'Asia/Bangkok',
    language: 'en',
    taxType: 'VAT',
    taxRate: 7.0,
    dateFormat: 'DD/MM/YYYY'
  },
  ID: {
    countryName: 'Indonesia',
    countryCode: 'ID',
    currency: 'IDR',
    timezone: 'Asia/Jakarta',
    language: 'en',
    taxType: 'VAT',
    taxRate: 11.0,
    dateFormat: 'DD/MM/YYYY'
  },
  PH: {
    countryName: 'Philippines',
    countryCode: 'PH',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    language: 'en',
    taxType: 'VAT',
    taxRate: 12.0,
    dateFormat: 'DD/MM/YYYY'
  },
  US: {
    countryName: 'United States',
    countryCode: 'US',
    currency: 'USD',
    timezone: 'America/New_York',
    language: 'en',
    taxType: 'Sales Tax',
    taxRate: 8.0,
    dateFormat: 'MM/DD/YYYY'
  },
  GB: {
    countryName: 'United Kingdom',
    countryCode: 'GB',
    currency: 'GBP',
    timezone: 'Europe/London',
    language: 'en',
    taxType: 'VAT',
    taxRate: 20.0,
    dateFormat: 'DD/MM/YYYY'
  },
  AU: {
    countryName: 'Australia',
    countryCode: 'AU',
    currency: 'AUD',
    timezone: 'Australia/Sydney',
    language: 'en',
    taxType: 'GST',
    taxRate: 10.0,
    dateFormat: 'DD/MM/YYYY'
  }
};
